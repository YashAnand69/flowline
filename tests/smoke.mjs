import assert from 'node:assert/strict';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3001';
let cookie = '';
async function request(path, method = 'GET', body, headers = {}) {
  const r = await fetch(origin + '/api/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.headers.get('set-cookie'))
    cookie = r.headers.get('set-cookie').split(';')[0];
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify({ path, status: r.status, data }));
  return data;
}
assert.equal((await request('health')).status, 'ok');
const account = await request('session', 'POST', {});
let flow;
try {
  const definition = {
    name: 'Smoke test — webhook to output',
    description: 'Automated end-to-end verification',
    active: true,
    nodes: [
      {
        id: 'trigger',
        type: 'flowNode',
        position: { x: 0, y: 0 },
        data: { kind: 'webhook', label: 'Event', config: {} },
      },
      {
        id: 'transform',
        type: 'flowNode',
        position: { x: 300, y: 0 },
        data: {
          kind: 'transform',
          label: 'Shape',
          config: { json: '{"message":"Hello {{trigger.name}}"}' },
        },
      },
      {
        id: 'log',
        type: 'flowNode',
        position: { x: 600, y: 0 },
        data: { kind: 'log', label: 'Output', config: {} },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'transform' },
      { id: 'e2', source: 'transform', target: 'log' },
    ],
  };
  flow = (await request('workflows', 'POST', definition)).workflow;
  assert.ok(
    (await request('workflows')).workflows.some((w) => w.id === flow.id),
  );
  const run = await request(
    `hooks/${flow.id}`,
    'POST',
    { name: 'Flowline' },
    { 'X-Flowline-Secret': flow.webhookSecret },
  );
  let result;
  for (let i = 0; i < 45; i++) {
    result = (await request(`runs/${run.id}`)).run;
    if (['success', 'failed'].includes(result.status)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.deepEqual(result.steps.at(-1).output, { message: 'Hello Flowline' });
  assert.equal(result.source, 'webhook');
  assert.equal(result.dryRun, false);
  const oldCookie = cookie;
  cookie = '';
  await request('session', 'POST', { recoveryKey: account.recoveryKey });
  assert.ok(cookie);
  assert.equal((await request(`workflows/${flow.id}`)).workflow.id, flow.id);
  console.log(
    'PASS: health → private workspace → persistent workflow → authenticated live webhook → background worker → transform → output → run history → recovery.',
  );
} finally {
  if (flow) await request(`workflows/${flow.id}`, 'DELETE');
  await request('session', 'DELETE');
}
