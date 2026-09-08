import { getStore } from '@netlify/blobs';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
export interface Storage {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(prefix: string): Promise<T[]>;
}
export class MemoryStorage implements Storage {
  data = new Map<string, unknown>();
  async get<T>(k: string) {
    return structuredClone(this.data.get(k) ?? null) as T | null;
  }
  async set(k: string, v: unknown) {
    this.data.set(k, structuredClone(v));
  }
  async delete(k: string) {
    this.data.delete(k);
  }
  async list<T>(p: string) {
    return [...this.data.entries()]
      .filter(([k]) => k.startsWith(p))
      .map(([, v]) => structuredClone(v) as T);
  }
}
export class FileStorage implements Storage {
  constructor(private dir = '.data') {}
  private file(k: string) {
    return path.join(this.dir, Buffer.from(k).toString('base64url') + '.json');
  }
  async get<T>(k: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(k), 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async set(k: string, v: unknown) {
    await mkdir(this.dir, { recursive: true });
    const file = this.file(k),
      tmp = file + '.' + crypto.randomUUID();
    await writeFile(tmp, JSON.stringify(v), { mode: 0o600 });
    await rename(tmp, file);
  }
  async delete(k: string) {
    await unlink(this.file(k)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
  async list<T>(p: string) {
    await mkdir(this.dir, { recursive: true });
    const names = (await readdir(this.dir)).filter(
      (n) =>
        n.endsWith('.json') &&
        Buffer.from(n.slice(0, -5), 'base64url').toString().startsWith(p),
    );
    return (
      await Promise.all(
        names.map((n) =>
          this.get<T>(Buffer.from(n.slice(0, -5), 'base64url').toString()),
        ),
      )
    ).filter(Boolean) as T[];
  }
}
export class BlobStorage implements Storage {
  constructor(private scope = 'production') {}
  private store() {
    return getStore({
      name: `flowline-${this.scope.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40)}`,
      consistency: 'strong',
    });
  }
  async get<T>(k: string): Promise<T | null> {
    return this.store().get(k, { type: 'json' });
  }
  async set(k: string, v: unknown) {
    await this.store().setJSON(k, v);
  }
  async delete(k: string) {
    await this.store().delete(k);
  }
  async list<T>(p: string) {
    const { blobs } = await this.store().list({ prefix: p });
    return (await Promise.all(blobs.map((b) => this.get<T>(b.key)))).filter(
      Boolean,
    ) as T[];
  }
}
export class PostgresStorage implements Storage {
  private pool: Pool;
  private ready: Promise<unknown>;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
    this.ready = this.pool.query(
      'CREATE TABLE IF NOT EXISTS flowline_records (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
  }
  async get<T>(k: string): Promise<T | null> {
    await this.ready;
    const r = await this.pool.query(
      'SELECT value FROM flowline_records WHERE key=$1',
      [k],
    );
    return r.rows[0]?.value ?? null;
  }
  async set(k: string, v: unknown) {
    await this.ready;
    await this.pool.query(
      'INSERT INTO flowline_records(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',
      [k, JSON.stringify(v)],
    );
  }
  async delete(k: string) {
    await this.ready;
    await this.pool.query('DELETE FROM flowline_records WHERE key=$1', [k]);
  }
  async list<T>(p: string) {
    await this.ready;
    const r = await this.pool.query(
      'SELECT value FROM flowline_records WHERE starts_with(key,$1)',
      [p],
    );
    return r.rows.map((r) => r.value);
  }
}
