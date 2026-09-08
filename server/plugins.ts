import { z } from 'zod';
import type { Kind, FlowNode } from '../shared/model';
export class PluginError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export type Credentials = {
  slack?: { url: string };
  email?: { apiKey: string; from: string };
};
export type PluginContext = {
  input: unknown;
  trigger: unknown;
  steps: Record<string, unknown>;
  credentials: Credentials;
  dryRun: boolean;
  fetcher: typeof fetch;
};
export interface ActionPlugin {
  kind: Kind;
  validate(config: Record<string, unknown>): void;
  execute(
    config: Record<string, unknown>,
    context: PluginContext,
  ): Promise<{ output: unknown; continue?: boolean }>;
}
export interface TriggerPlugin {
  kind: 'webhook';
  subscribe(
    workflowId: string,
    origin: string,
  ): { url: string; method: 'POST'; authentication: string };
}
export const webhookTrigger: TriggerPlugin = {
  kind: 'webhook',
  subscribe: (id, origin) => ({
    url: `${origin}/api/hooks/${id}`,
    method: 'POST',
    authentication: 'X-Flowline-Secret or GitHub HMAC SHA-256',
  }),
};
export function resolvePath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => {
    if (['__proto__', 'constructor', 'prototype'].includes(k))
      throw new PluginError('Unsafe data path.');
    return v && typeof v === 'object' && Object.hasOwn(v, k)
      ? (v as Record<string, unknown>)[k]
      : undefined;
  }, source);
}
export function interpolate(
  value: unknown,
  ctx: Pick<PluginContext, 'input' | 'trigger' | 'steps'>,
): unknown {
  if (Array.isArray(value)) return value.map((v) => interpolate(v, ctx));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, ctx)]),
    );
  if (typeof value !== 'string') return value;
  const full = value.match(/^\{\{\s*([\w.-]+)\s*\}\}$/);
  if (full) return resolvePath(ctx, full[1]) ?? null;
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, p) => {
    const v = resolvePath(ctx, p);
    return v === undefined || v === null
      ? ''
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
  });
}
const string = (c: Record<string, unknown>, key: string, max = 10000) =>
  z.string().min(1).max(max).parse(c[key]);
async function deliver(ctx: PluginContext, url: string, options: RequestInit) {
  let response: Response;
  try {
    response = await ctx.fetcher(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new PluginError(
      'The provider could not be reached. Try again shortly.',
      true,
    );
  }
  if (!response.ok)
    throw new PluginError(
      `The provider returned HTTP ${response.status}. Check the integration and message settings.`,
      response.status === 429 || response.status >= 500,
    );
  return response;
}
export const plugins: Record<Kind, ActionPlugin> = {
  webhook: {
    kind: 'webhook',
    validate() {},
    async execute(_, ctx) {
      return { output: ctx.trigger };
    },
  },
  transform: {
    kind: 'transform',
    validate(c) {
      JSON.parse(string(c, 'json', 20000));
    },
    async execute(c, ctx) {
      return { output: interpolate(JSON.parse(String(c.json)), ctx) };
    },
  },
  filter: {
    kind: 'filter',
    validate(c) {
      string(c, 'field');
      z.enum([
        'equals',
        'not_equals',
        'contains',
        'exists',
        'greater_than',
      ]).parse(c.operator);
    },
    async execute(c, ctx) {
      const actual = interpolate(c.field, ctx),
        expected = interpolate(c.value, ctx);
      let passes = false;
      switch (c.operator) {
        case 'equals':
          passes = String(actual) === String(expected);
          break;
        case 'not_equals':
          passes = String(actual) !== String(expected);
          break;
        case 'contains':
          passes = String(actual ?? '').includes(String(expected ?? ''));
          break;
        case 'exists':
          passes = actual !== null && actual !== undefined && actual !== '';
          break;
        case 'greater_than':
          passes = Number(actual) > Number(expected);
          break;
      }
      return { output: { matched: passes, value: actual }, continue: passes };
    },
  },
  log: {
    kind: 'log',
    validate() {},
    async execute(_, ctx) {
      return { output: ctx.input };
    },
  },
  slack: {
    kind: 'slack',
    validate(c) {
      string(c, 'message');
    },
    async execute(c, ctx) {
      const text = String(interpolate(c.message, ctx));
      if (!text.trim()) throw new PluginError('Slack message is empty.');
      if (ctx.dryRun)
        return { output: { preview: true, provider: 'Slack', text } };
      const url = ctx.credentials.slack?.url;
      if (!url)
        throw new PluginError(
          'Connect Slack in Integrations before sending a message.',
        );
      if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url))
        throw new PluginError('The Slack webhook URL is invalid.');
      await deliver(ctx, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return { output: { delivered: true, provider: 'Slack' } };
    },
  },
  email: {
    kind: 'email',
    validate(c) {
      string(c, 'to', 500);
      string(c, 'subject', 500);
      string(c, 'body');
    },
    async execute(c, ctx) {
      const to = String(interpolate(c.to, ctx)),
        subject = String(interpolate(c.subject, ctx)),
        text = String(interpolate(c.body, ctx));
      if (!z.string().email().safeParse(to).success)
        throw new PluginError('The recipient is not a valid email address.');
      if (ctx.dryRun)
        return {
          output: { preview: true, provider: 'Resend', to, subject, text },
        };
      const credentials = ctx.credentials.email;
      if (!credentials)
        throw new PluginError(
          'Connect Resend in Integrations before sending email.',
        );
      const response = await deliver(ctx, 'https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credentials.apiKey}`,
        },
        body: JSON.stringify({
          from: credentials.from,
          to: [to],
          subject,
          text,
        }),
      });
      const result = (await response.json()) as { id?: string };
      return { output: { delivered: true, provider: 'Resend', id: result.id } };
    },
  },
};
export function validateNode(node: FlowNode) {
  try {
    plugins[node.data.kind].validate(node.data.config);
  } catch (e) {
    throw new PluginError(
      `${node.data.label}: ${e instanceof SyntaxError ? 'Enter valid JSON for the transform.' : e instanceof z.ZodError ? 'Complete the required node settings.' : (e as Error).message}`,
    );
  }
}
