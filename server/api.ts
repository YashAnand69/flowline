import { z } from 'zod';
import type { Storage } from './storage';
import {
  workflowSchema,
  type Workflow,
  type Run,
  type Workspace,
  makeTemplate,
} from '../shared/model';
import { validateGraph } from './engine';
import {
  token,
  hash,
  equal,
  seal,
  unseal,
  githubSignature,
  scrub,
} from './security';
import type { Credentials } from './plugins';
export type Environment = {
  store: Storage;
  encryptionKey: string;
  origin?: string;
  dispatch: (run: Run) => Promise<void>;
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function json(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}
function safeFlow(w: Workflow) {
  const { owner, ...flow } = w;
  return flow;
}
function safeRun(r: Run) {
  const { definition, owner, ...run } = r;
  return scrub(run);
}
function sessionCookie(value: string, secure: boolean) {
  return `flowline_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${value ? 2592000 : 0}${secure ? '; Secure' : ''}`;
}
async function readBody(req: Request) {
  const text = await req.text();
  if (Buffer.byteLength(text) > 65536)
    throw new HttpError(413, 'Payload must be smaller than 64 KB.');
  return text;
}
const ident = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
async function owned(env: Environment, id: string, owner: string) {
  ident.parse(id);
  const w = await env.store.get<Workflow>(`workflows/${owner}/${id}`);
  if (!w) throw new HttpError(404, 'Workflow not found.');
  return w;
}
async function auth(req: Request, env: Environment) {
  const session = req.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)flowline_session=([^;]+)/)?.[1];
  if (!session)
    throw new HttpError(401, 'Open or restore your workspace to continue.');
  const record = await env.store.get<{ owner: string; expires: number }>(
    `sessions/${hash(session)}`,
  );
  if (!record || record.expires < Date.now())
    throw new HttpError(
      401,
      'Your session expired. Restore your workspace with its recovery key.',
    );
  const workspace = await env.store.get<Workspace>(
    `workspaces/${record.owner}`,
  );
  if (!workspace) throw new HttpError(401, 'Workspace not found.');
  return workspace;
}
async function startSession(
  workspace: Workspace,
  env: Environment,
  secure: boolean,
  recoveryKey?: string,
) {
  const session = token();
  await env.store.set(`sessions/${hash(session)}`, {
    owner: workspace.id,
    expires: Date.now() + 2592000000,
  });
  return json(
    {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt,
      },
      recoveryKey,
    },
    200,
    { 'Set-Cookie': sessionCookie(session, secure) },
  );
}
async function queue(
  env: Environment,
  flow: Workflow,
  input: unknown,
  source: 'manual' | 'webhook',
  dryRun = false,
) {
  validateGraph(flow);
  const recent = await env.store.list<Run>(`runs/${flow.owner}/`);
  if (
    recent.filter((r) => Date.parse(r.createdAt) > Date.now() - 86400000)
      .length >= 200
  )
    throw new HttpError(
      429,
      'Daily workspace limit reached (200 runs). Try again tomorrow.',
    );
  if (
    recent.filter(
      (r) =>
        ['queued', 'running'].includes(r.status) &&
        Date.parse(r.createdAt) > Date.now() - 900000,
    ).length >= 5
  )
    throw new HttpError(
      429,
      'Five runs are in progress. Wait for one to finish.',
    );
  const run: Run = {
    id: crypto.randomUUID(),
    workflowId: flow.id,
    workflowName: flow.name,
    owner: flow.owner,
    status: 'queued',
    source,
    createdAt: new Date().toISOString(),
    steps: [],
    input,
    definition: structuredClone(flow),
    dryRun,
  };
  await env.store.set(`runs/${flow.owner}/${run.id}`, run);
  try {
    await env.dispatch(run);
  } catch {
    run.status = 'failed';
    run.error = 'Could not start the execution worker. Please retry.';
    run.finishedAt = new Date().toISOString();
    await env.store.set(`runs/${flow.owner}/${run.id}`, run);
    throw new HttpError(503, run.error);
  }
  return run;
}
export async function handleApi(
  req: Request,
  env: Environment,
): Promise<Response> {
  try {
    const url = new URL(req.url),
      parts = url.pathname
        .replace(/^\/api\/?/, '')
        .split('/')
        .filter(Boolean);
    const [resource, id, action] = parts;
    const origin = env.origin ?? url.origin,
      secure = origin.startsWith('https:');
    if (req.method === 'OPTIONS') return new Response(null, { status: 405 });
    if (req.method !== 'GET' && req.method !== 'HEAD' && resource !== 'hooks') {
      const requestOrigin = req.headers.get('origin');
      if (requestOrigin && requestOrigin !== origin)
        throw new HttpError(403, 'This request came from another website.');
      if (
        req.method !== 'DELETE' &&
        !req.headers.get('content-type')?.includes('application/json')
      )
        throw new HttpError(415, 'Use application/json.');
    }
    if (resource === 'health' && req.method === 'GET') {
      await env.store.get('_health');
      return json({ status: 'ok', service: 'flowline', version: '1.0.0' });
    }
    if (resource === 'session') {
      if (req.method === 'POST') {
        const data = JSON.parse((await readBody(req)) || '{}');
        if (data.recoveryKey) {
          const key = z.string().min(30).max(100).parse(data.recoveryKey);
          const record = await env.store.get<{ owner: string }>(
            `recovery/${hash(key)}`,
          );
          const w =
            record &&
            (await env.store.get<Workspace>(`workspaces/${record.owner}`));
          if (!w || !equal(w.recoveryHash, hash(key)))
            throw new HttpError(401, 'That recovery key was not recognized.');
          return startSession(w, env, secure);
        }
        const recoveryKey = 'flw_' + token();
        const w: Workspace = {
          id: crypto.randomUUID(),
          name: 'Personal workspace',
          createdAt: new Date().toISOString(),
          recoveryHash: hash(recoveryKey),
        };
        await env.store.set(`workspaces/${w.id}`, w);
        await env.store.set(`recovery/${w.recoveryHash}`, { owner: w.id });
        return startSession(w, env, secure, recoveryKey);
      }
      if (req.method === 'GET') {
        const w = await auth(req, env);
        return json({
          workspace: { id: w.id, name: w.name, createdAt: w.createdAt },
        });
      }
      if (req.method === 'DELETE') {
        const session = req.headers
          .get('cookie')
          ?.match(/(?:^|;\s*)flowline_session=([^;]+)/)?.[1];
        if (session) await env.store.delete(`sessions/${hash(session)}`);
        return json({ ok: true }, 200, {
          'Set-Cookie': sessionCookie('', secure),
        });
      }
    }
    if (resource === 'hooks' && id && req.method === 'POST') {
      ident.parse(id);
      const pointer = await env.store.get<{ owner: string }>(`hooks/${id}`);
      const w =
        pointer &&
        (await env.store.get<Workflow>(`workflows/${pointer.owner}/${id}`));
      if (!w) throw new HttpError(404, 'Webhook not found.');
      const body = await readBody(req);
      const supplied = req.headers.get('x-flowline-secret') || '',
        signature = req.headers.get('x-hub-signature-256') || '';
      if (
        !equal(supplied, w.webhookSecret) &&
        !equal(signature, githubSignature(body, w.webhookSecret))
      )
        throw new HttpError(401, 'Invalid webhook secret or signature.');
      if (!w.active) throw new HttpError(409, 'This workflow is paused.');
      const input = JSON.parse(body || '{}');
      const run = await queue(env, w, input, 'webhook');
      return json({ id: run.id, status: run.status }, 202);
    }
    const workspace = await auth(req, env),
      owner = workspace.id;
    if (resource === 'workspace' && req.method === 'PATCH') {
      const data = JSON.parse(await readBody(req));
      workspace.name = z.string().min(1).max(60).parse(data.name);
      await env.store.set(`workspaces/${owner}`, workspace);
      return json({ name: workspace.name });
    }
    if (resource === 'recovery' && req.method === 'POST') {
      const previous = workspace.recoveryHash,
        recoveryKey = 'flw_' + token();
      workspace.recoveryHash = hash(recoveryKey);
      await env.store.set(`recovery/${workspace.recoveryHash}`, { owner });
      await env.store.set(`workspaces/${owner}`, workspace);
      await env.store.delete(`recovery/${previous}`);
      return json({ recoveryKey });
    }
    if (resource === 'workflows') {
      if (!id && req.method === 'GET') {
        const workflows = await env.store.list<Workflow>(`workflows/${owner}/`);
        return json({
          workflows: workflows
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(safeFlow),
        });
      }
      if (!id && req.method === 'POST') {
        const existing = await env.store.list<Workflow>(`workflows/${owner}/`);
        if (existing.length >= 30)
          throw new HttpError(
            409,
            'This workspace supports up to 30 workflows. Export and remove unused flows first.',
          );
        const data = workflowSchema.parse(JSON.parse(await readBody(req)));
        validateGraph(data);
        const now = new Date().toISOString();
        const w: Workflow = {
          ...data,
          owner,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          webhookSecret: token(),
          version: 1,
        };
        await env.store.set(`workflows/${owner}/${w.id}`, w);
        await env.store.set(`hooks/${w.id}`, { owner });
        return json({ workflow: safeFlow(w) }, 201);
      }
      if (id) {
        const w = await owned(env, id, owner);
        if (req.method === 'GET') return json({ workflow: safeFlow(w) });
        if (req.method === 'PUT') {
          const raw = JSON.parse(await readBody(req));
          if (raw.version !== w.version)
            throw new HttpError(
              409,
              'This workflow changed in another tab. Reload before saving.',
            );
          const data = workflowSchema.parse(raw);
          validateGraph(data);
          const updated = {
            ...w,
            ...data,
            updatedAt: new Date().toISOString(),
            version: w.version + 1,
          };
          await env.store.set(`workflows/${owner}/${id}`, updated);
          return json({ workflow: safeFlow(updated) });
        }
        if (req.method === 'DELETE') {
          await env.store.delete(`hooks/${id}`);
          await env.store.delete(`workflows/${owner}/${id}`);
          return json({ ok: true });
        }
        if (action === 'rotate-secret' && req.method === 'POST') {
          w.webhookSecret = token();
          w.version++;
          w.updatedAt = new Date().toISOString();
          await env.store.set(`workflows/${owner}/${id}`, w);
          return json({ workflow: safeFlow(w) });
        }
        if (action === 'run' && req.method === 'POST') {
          const data = JSON.parse(await readBody(req));
          const run = await queue(
            env,
            w,
            data.input ?? {},
            'manual',
            Boolean(data.dryRun),
          );
          return json({ run: safeRun(run) }, 202);
        }
      }
    }
    if (resource === 'runs' && req.method === 'GET') {
      if (id) {
        ident.parse(id);
        const run = await env.store.get<Run>(`runs/${owner}/${id}`);
        if (!run) throw new HttpError(404, 'Execution not found.');
        return json({ run: safeRun(run) });
      }
      const all = await env.store.list<Run>(`runs/${owner}/`);
      return json({
        runs: all
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 100)
          .map(safeRun),
      });
    }
    if (resource === 'integrations') {
      if (req.method === 'GET') {
        const entries = await env.store.list<{
          kind: string;
          createdAt: string;
          encrypted: string;
        }>(`credentials/${owner}/`);
        return json({
          integrations: entries.map(({ kind, createdAt }) => ({
            kind,
            createdAt,
            connected: true,
          })),
        });
      }
      if (id && !['slack', 'email'].includes(id))
        throw new HttpError(400, 'Unknown integration.');
      if (id && req.method === 'PUT') {
        const data = JSON.parse(await readBody(req));
        let parsed: unknown;
        if (id === 'slack')
          parsed = z
            .object({
              url: z
                .string()
                .regex(
                  /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/,
                ),
            })
            .parse(data);
        else
          parsed = z
            .object({
              apiKey: z.string().startsWith('re_').min(15).max(200),
              from: z.string().min(3).max(200),
            })
            .parse(data);
        await env.store.set(`credentials/${owner}/${id}`, {
          kind: id,
          createdAt: new Date().toISOString(),
          encrypted: seal(parsed, env.encryptionKey),
        });
        return json({ ok: true });
      }
      if (id && req.method === 'DELETE') {
        await env.store.delete(`credentials/${owner}/${id}`);
        return json({ ok: true });
      }
    }
    throw new HttpError(404, 'Endpoint not found.');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json(
        {
          error: e.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
        400,
      );
    if (e instanceof SyntaxError)
      return json({ error: 'Enter valid JSON.' }, 400);
    if (
      (e as Error).name === 'Error' &&
      (e as Error).message.includes('workflow')
    )
      return json({ error: (e as Error).message }, 400);
    const name = (e as Error).constructor.name;
    if (name === 'PluginError')
      return json({ error: (e as Error).message }, 400);
    console.error('Flowline request failed:', (e as Error).message);
    return json(
      {
        error: 'The server could not complete this request. Please try again.',
      },
      500,
    );
  }
}
export async function credentialsFor(
  store: Storage,
  owner: string,
  key: string,
): Promise<Credentials> {
  const entries = await store.list<{
    kind: 'slack' | 'email';
    encrypted: string;
  }>(`credentials/${owner}/`);
  return Object.fromEntries(
    entries.map((e) => [e.kind, unseal(e.encrypted, key)]),
  );
}
