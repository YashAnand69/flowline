import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTemplate, type Run, type Workflow } from '../shared/model';
import { executeRun, validateGraph } from '../server/engine';
import {
  plugins,
  interpolate,
  PluginError,
  webhookTrigger,
} from '../server/plugins';
import { seal, unseal, githubSignature, scrub } from '../server/security';
function run(index = 0): Run {
  const w: Workflow = {
    ...makeTemplate(index),
    id: 'wf',
    owner: 'owner',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    webhookSecret: 'secret',
  };
  return {
    id: 'r',
    owner: 'owner',
    workflowId: 'wf',
    workflowName: w.name,
    status: 'queued',
    source: 'manual',
    createdAt: new Date().toISOString(),
    steps: [],
    input: { name: 'Alex', email: 'alex@example.com', action: 'closed' },
    definition: w,
    dryRun: true,
  };
}
test('a complete webhook → transform → output workflow preserves data', async () => {
  const r = run();
  const states: string[] = [];
  await executeRun(r, {}, async (v) => {
    states.push(v.status);
  });
  assert.equal(r.status, 'success');
  assert.equal(r.steps.length, 3);
  assert.deepEqual(r.steps[2].output, {
    name: 'Alex',
    email: 'alex@example.com',
    message: 'Welcome to Flowline, Alex!',
  });
  assert.ok(states.includes('running'));
});
test('a false condition skips downstream actions without calling the provider', async () => {
  const r = run(1);
  r.dryRun = false;
  let called = false;
  await executeRun(r, {}, async () => {}, {
    fetcher: async () => {
      called = true;
      throw new Error('Must not call');
    },
  });
  assert.equal(r.status, 'success');
  assert.equal(r.steps[2].status, 'skipped');
  assert.equal(called, false);
});
test('a false branch does not prevent independent branches', async () => {
  const r = run(1);
  r.definition.nodes.push({
    id: 'other',
    type: 'flowNode',
    position: { x: 0, y: 0 },
    data: { kind: 'log', label: 'Independent', config: {} },
  });
  r.definition.edges.push({
    id: 'other-edge',
    source: 'trigger',
    target: 'other',
  });
  await executeRun(r, {}, async () => {});
  assert.equal(r.steps.find((s) => s.nodeId === 'other')?.status, 'success');
  assert.equal(r.steps.find((s) => s.nodeId === 'slack')?.status, 'skipped');
});
test('transient provider errors retry with exponential backoff', async () => {
  const r = run(1);
  r.input = { action: 'opened', issue: { title: 'Test' } };
  r.dryRun = false;
  let attempts = 0;
  const waits: number[] = [];
  await executeRun(
    r,
    { slack: { url: 'https://hooks.slack.com/services/T/B/token' } },
    async () => {},
    {
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetcher: async () => {
        attempts++;
        return new Response('', { status: attempts < 3 ? 503 : 200 });
      },
    },
  );
  assert.equal(r.status, 'success');
  assert.equal(r.steps[2].attempts, 3);
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(r.steps[2].error, undefined);
});
test('retry exhaustion produces a failed run with readable diagnostics', async () => {
  const r = run(1);
  r.input = { action: 'opened', issue: { title: 'Test' } };
  r.dryRun = false;
  await executeRun(
    r,
    { slack: { url: 'https://hooks.slack.com/services/T/B/token' } },
    async () => {},
    {
      sleep: async () => {},
      fetcher: async () => new Response('', { status: 429 }),
    },
  );
  assert.equal(r.status, 'failed');
  assert.equal(r.steps[2].attempts, 3);
  assert.match(r.error!, /429/);
  assert.ok(r.finishedAt);
});
test('permanent provider errors fail once', async () => {
  const r = run(2);
  r.dryRun = false;
  await executeRun(
    r,
    { email: { apiKey: 're_test', from: 'hello@example.com' } },
    async () => {},
    { fetcher: async () => new Response('', { status: 401 }) },
  );
  assert.equal(r.status, 'failed');
  assert.equal(r.steps[1].attempts, 1);
});
test('preview email does not require credentials or send a request', async () => {
  const r = run(2);
  await executeRun(r, {}, async () => {}, {
    fetcher: async () => {
      throw new Error('Unexpected send');
    },
  });
  assert.equal(r.status, 'success');
  assert.equal((r.steps[1].output as any).preview, true);
});
test('missing credentials cannot masquerade as successful live delivery', async () => {
  const r = run(2);
  r.dryRun = false;
  await executeRun(r, {}, async () => {});
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /Connect Resend/);
});
test('graph rejects loops, missing endpoints, disconnected actions and duplicate IDs', () => {
  for (const mutate of [
    (w: Workflow) =>
      w.edges.push({ id: 'loop', source: 'log', target: 'transform' }),
    (w: Workflow) =>
      w.edges.push({ id: 'bad', source: 'missing', target: 'log' }),
    (w: Workflow) => {
      w.edges = [];
    },
    (w: Workflow) => w.nodes.push(w.nodes[0]),
  ]) {
    const w = run().definition;
    mutate(w);
    assert.throws(() => validateGraph(w));
  }
});
test('prototype traversal is blocked and interpolation preserves value types', () => {
  const ctx = {
    trigger: { count: 42, object: { a: true } },
    steps: {},
    input: null,
  };
  assert.equal(interpolate('{{trigger.count}}', ctx), 42);
  assert.deepEqual(interpolate('{{trigger.object}}', ctx), { a: true });
  assert.equal(interpolate('Count: {{trigger.count}}', ctx), 'Count: 42');
  assert.equal(interpolate('{{trigger.missing}}', ctx), null);
  assert.throws(() => interpolate('{{trigger.__proto__.x}}', ctx), /Unsafe/);
});
test('credential encryption authenticates data and rejects the wrong key', () => {
  const key = 'a'.repeat(64),
    encrypted = seal({ apiKey: 'private' }, key);
  assert.ok(!encrypted.includes('private'));
  assert.deepEqual(unseal(encrypted, key), { apiKey: 'private' });
  assert.throws(() => unseal(encrypted, 'b'.repeat(64)));
});
test('sensitive values are redacted from inspectable output', () => {
  assert.deepEqual(
    scrub({ name: 'Alex', apiKey: '123', nested: { password: 'abc' } }),
    { name: 'Alex', apiKey: '[redacted]', nested: { password: '[redacted]' } },
  );
});
for (const [kind, plugin] of Object.entries(plugins)) {
  test(`plugin contract: ${kind}`, async () => {
    assert.equal(plugin.kind, kind);
    assert.equal(typeof plugin.validate, 'function');
    assert.equal(typeof plugin.execute, 'function');
    const config =
      kind === 'transform'
        ? { json: '{"name":"{{trigger.name}}"}' }
        : kind === 'filter'
          ? { field: '{{trigger.name}}', operator: 'equals', value: 'Alex' }
          : kind === 'slack'
            ? { message: 'Hello {{trigger.name}}' }
            : kind === 'email'
              ? { to: '{{trigger.email}}', subject: 'Hello', body: 'Welcome' }
              : {};
    plugin.validate(config);
    const result = await plugin.execute(config, {
      trigger: { name: 'Alex', email: 'alex@example.com' },
      input: { ok: true },
      steps: {},
      credentials: {},
      dryRun: true,
      fetcher: async () => {
        throw new Error('Contract previews never send');
      },
    });
    assert.ok(Object.hasOwn(result, 'output'));
    assert.doesNotThrow(() => JSON.stringify(result));
  });
}
test('trigger contract exposes a signed POST webhook endpoint', () => {
  assert.deepEqual(webhookTrigger.subscribe('id', 'https://example.com'), {
    url: 'https://example.com/api/hooks/id',
    method: 'POST',
    authentication: 'X-Flowline-Secret or GitHub HMAC SHA-256',
  });
});
