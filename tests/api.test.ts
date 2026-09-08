import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, type Environment } from '../server/api';
import { MemoryStorage } from '../server/storage';
import { makeTemplate, type Run } from '../shared/model';
import { executeRun } from '../server/engine';
import { githubSignature } from '../server/security';
const base = 'https://flowline.test';
function setup() {
  const store = new MemoryStorage(),
    dispatched: Run[] = [];
  const env: Environment = {
    store,
    encryptionKey: 'a'.repeat(64),
    dispatch: async (r) => {
      dispatched.push(r);
    },
  };
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie?: string,
    headers: Record<string, string> = {},
  ) =>
    handleApi(
      new Request(base + '/api/' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  return { store, dispatched, request, env };
}
async function session(request: ReturnType<typeof setup>['request']) {
  const r = await request('session', 'POST', {});
  const data = (await r.json()) as any;
  return { cookie: r.headers.get('set-cookie')!.split(';')[0], ...data };
}
test('private workspace CRUD, preview execution and persistent run history', async () => {
  const { request, store, dispatched } = setup();
  const user = await session(request);
  assert.match(user.recoveryKey, /^flw_/);
  let res = await request('workflows', 'POST', makeTemplate(), user.cookie);
  assert.equal(res.status, 201);
  const { workflow: w } = (await res.json()) as any;
  res = await request(
    `workflows/${w.id}/run`,
    'POST',
    { input: { name: 'Alex', email: 'alex@example.com' }, dryRun: true },
    user.cookie,
  );
  assert.equal(res.status, 202);
  assert.equal(dispatched.length, 1);
  await executeRun(dispatched[0], {}, (r) =>
    store.set(`runs/${r.owner}/${r.id}`, r),
  );
  res = await request('runs', 'GET', undefined, user.cookie);
  const data = (await res.json()) as any;
  assert.equal(data.runs[0].status, 'success');
  assert.equal(data.runs[0].definition, undefined);
  assert.equal(data.runs[0].owner, undefined);
  res = await request(`workflows/${w.id}`, 'DELETE', undefined, user.cookie);
  assert.equal(res.status, 200);
  res = await request(`hooks/${w.id}`, 'POST', {}, undefined, {
    'x-flowline-secret': w.webhookSecret,
  });
  assert.equal(res.status, 404);
});
test('one workspace cannot read, modify, run or delete another workspace flow', async () => {
  const { request } = setup();
  const a = await session(request),
    b = await session(request);
  const { workflow: w } = (await (
    await request('workflows', 'POST', makeTemplate(), a.cookie)
  ).json()) as any;
  for (const [method, suffix, body] of [
    ['GET', '', undefined],
    ['DELETE', '', undefined],
    ['PUT', '', w],
    ['POST', '/run', {}],
  ] as const) {
    const result = await request(
      `workflows/${w.id}${suffix}`,
      method,
      body,
      b.cookie,
    );
    assert.equal(result.status, 404);
  }
  const list = (await (
    await request('workflows', 'GET', undefined, b.cookie)
  ).json()) as any;
  assert.equal(list.workflows.length, 0);
});
test('recovery restores the workspace and rotation invalidates the old key', async () => {
  const { request } = setup();
  const user = await session(request);
  const restored = await request('session', 'POST', {
    recoveryKey: user.recoveryKey,
  });
  assert.equal(restored.status, 200);
  const { recoveryKey: newKey } = (await (
    await request('recovery', 'POST', {}, user.cookie)
  ).json()) as any;
  assert.notEqual(newKey, user.recoveryKey);
  assert.equal(
    (await request('session', 'POST', { recoveryKey: user.recoveryKey }))
      .status,
    401,
  );
  assert.equal(
    (await request('session', 'POST', { recoveryKey: newKey })).status,
    200,
  );
});
test('webhooks reject invalid signatures and paused flows, then accept a signed GitHub event', async () => {
  const { request, dispatched } = setup();
  const user = await session(request);
  let { workflow: w } = (await (
    await request('workflows', 'POST', makeTemplate(), user.cookie)
  ).json()) as any;
  const body = { name: 'Alex' };
  assert.equal((await request(`hooks/${w.id}`, 'POST', body)).status, 401);
  assert.equal(
    (
      await request(`hooks/${w.id}`, 'POST', body, undefined, {
        'x-flowline-secret': w.webhookSecret,
      })
    ).status,
    409,
  );
  ({ workflow: w } = (await (
    await request(
      `workflows/${w.id}`,
      'PUT',
      { ...w, active: true },
      user.cookie,
    )
  ).json()) as any);
  const sig = githubSignature(JSON.stringify(body), w.webhookSecret);
  assert.equal(
    (
      await request(`hooks/${w.id}`, 'POST', body, undefined, {
        'x-hub-signature-256': sig,
      })
    ).status,
    202,
  );
  assert.equal(dispatched[0].source, 'webhook');
});
test('credentials are encrypted at rest and never returned by the list endpoint', async () => {
  const { request, store } = setup();
  const user = await session(request);
  const secret = 'https://hooks.slack.com/services/T/B/private';
  assert.equal(
    (await request('integrations/slack', 'PUT', { url: secret }, user.cookie))
      .status,
    200,
  );
  const raw = [...store.data.values()].map((v) => JSON.stringify(v)).join('');
  assert.ok(!raw.includes(secret));
  const list = await (
    await request('integrations', 'GET', undefined, user.cookie)
  ).text();
  assert.ok(!list.includes('encrypted'));
  assert.ok(!list.includes('private'));
  assert.ok(list.includes('slack'));
});
test('rejects cross-origin mutations, invalid graphs and stale edits', async () => {
  const { request } = setup();
  const user = await session(request);
  assert.equal(
    (
      await request('workflows', 'POST', makeTemplate(), user.cookie, {
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
  const bad = makeTemplate();
  bad.edges = [];
  assert.equal(
    (await request('workflows', 'POST', bad, user.cookie)).status,
    400,
  );
  const { workflow: w } = (await (
    await request('workflows', 'POST', makeTemplate(), user.cookie)
  ).json()) as any;
  assert.equal(
    (
      await request(
        `workflows/${w.id}`,
        'PUT',
        { ...w, name: 'Changed' },
        user.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`workflows/${w.id}`, 'PUT', w, user.cookie)).status,
    409,
  );
});
test('unauthenticated endpoints and oversized payloads fail intentionally', async () => {
  const { request } = setup();
  assert.equal((await request('workflows')).status, 401);
  assert.equal(
    (await request('session', 'POST', { name: 'x'.repeat(70000) })).status,
    413,
  );
});
test('worker dispatch failure is persisted as failed, never reported successful', async () => {
  const { request, env, store } = setup();
  const user = await session(request);
  const { workflow: w } = (await (
    await request('workflows', 'POST', makeTemplate(), user.cookie)
  ).json()) as any;
  env.dispatch = async () => {
    throw new Error('offline');
  };
  assert.equal(
    (await request(`workflows/${w.id}/run`, 'POST', {}, user.cookie)).status,
    503,
  );
  const runs = await store.list<Run>(`runs/${user.workspace.id}/`);
  assert.equal(runs[0].status, 'failed');
});
