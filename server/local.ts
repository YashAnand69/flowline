import express from 'express';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Queue, Worker } from 'bullmq';
import { FileStorage, PostgresStorage } from './storage';
import { handleApi, credentialsFor } from './api';
import { executeRun } from './engine';
import type { Run } from '../shared/model';
const dataDir = process.env.DATA_DIR || '.data';
await mkdir(dataDir, { recursive: true });
let key = process.env.ENCRYPTION_KEY;
if (!key) {
  try {
    key = await readFile(path.join(dataDir, '.encryption-key'), 'utf8');
  } catch {
    key = randomBytes(32).toString('hex');
    await writeFile(path.join(dataDir, '.encryption-key'), key, {
      mode: 0o600,
    });
  }
}
const store = process.env.DATABASE_URL
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new FileStorage(dataDir);
const execute = async (run: Run) => {
  const current = await store.get<Run>(`runs/${run.owner}/${run.id}`);
  if (!current || ['success', 'failed'].includes(current.status)) return;
  await executeRun(current, await credentialsFor(store, run.owner, key!), (r) =>
    store.set(`runs/${r.owner}/${r.id}`, r),
  );
};
let queue: Queue | undefined;
let worker: Worker | undefined;
if (process.env.REDIS_URL) {
  const url = new URL(process.env.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
  };
  queue = new Queue('flowline', { connection });
  worker = new Worker('flowline', async (job) => execute(job.data), {
    connection,
    concurrency: 4,
  });
  worker.on('error', (e) => console.error('Worker:', e.message));
}
const dispatch = async (run: Run) => {
  if (queue)
    await queue.add('execute', run, {
      jobId: run.id,
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  else
    setImmediate(() =>
      execute(run).catch((e) => console.error('Execution:', e.message)),
    );
};
const app = express();
app.disable('x-powered-by');
app.use('/api', express.raw({ type: () => true, limit: '64kb' }));
app.use('/api', async (req, res) => {
  try {
    const origin =
      process.env.APP_ORIGIN ||
      (process.env.PORT === '4317'
        ? 'http://localhost:5173'
        : 'http://localhost:3001');
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    const request = new Request(origin + req.originalUrl, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    });
    const result = await handleApi(request, {
      store,
      encryptionKey: key!,
      origin,
      dispatch,
    });
    res.status(result.status);
    result.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await result.arrayBuffer()));
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});
app.use(express.static('dist'));
app.get('/{*path}', (_req, res) =>
  res.sendFile(path.resolve('dist/index.html')),
);
const server = app.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () =>
  console.log(
    `Flowline API listening on http://localhost:${process.env.PORT || 3001} (${queue ? 'Postgres + Redis queue' : 'local durable storage'})`,
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close();
    void worker?.close();
    void queue?.close();
  });
