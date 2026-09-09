// Run during a brief read-only maintenance window. Existing Blobs remain a backup.
// NETLIFY_CLI_PATH points at the installed Netlify CLI entrypoint.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
const exec = promisify(execFile);
const {
  NETLIFY_CLI_PATH,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  MIGRATION_BACKUP_DIR,
} = process.env;
if (
  !NETLIFY_CLI_PATH ||
  !SUPABASE_URL ||
  !SUPABASE_SECRET_KEY ||
  !MIGRATION_BACKUP_DIR
)
  throw new Error(
    'Set NETLIFY_CLI_PATH, SUPABASE_URL, SUPABASE_SECRET_KEY and MIGRATION_BACKUP_DIR.',
  );
const cli = async (...args) =>
  (
    await exec(process.execPath, [NETLIFY_CLI_PATH, ...args], {
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
const store = 'flowline-production';
const before = JSON.parse(await cli('blobs:list', store, '--json')).blobs;
const records = [];
for (const blob of before)
  records.push({
    scope: 'production',
    key: blob.key,
    value: JSON.parse(await cli('blobs:get', store, blob.key)),
  });
const after = JSON.parse(await cli('blobs:list', store, '--json')).blobs;
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error(
    'Source changed during export. Wait for active runs and retry in maintenance mode.',
  );
await mkdir(MIGRATION_BACKUP_DIR, { recursive: true, mode: 0o700 });
await writeFile(
  `${MIGRATION_BACKUP_DIR}/flowline-blobs-backup.json`,
  JSON.stringify(records),
  { mode: 0o600 },
);
const client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
for (let i = 0; i < records.length; i += 100) {
  const { error } = await client
    .from('flowline_records')
    .upsert(records.slice(i, i + 100), {
      onConflict: 'scope,key',
      ignoreDuplicates: true,
    });
  if (error)
    throw new Error('Database import failed. Source backup is intact.');
}
for (const record of records) {
  const { data, error } = await client
    .from('flowline_records')
    .select('value')
    .eq('scope', record.scope)
    .eq('key', record.key)
    .single();
  // JSONB can reorder keys; compare canonical representations.
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  if (
    error ||
    JSON.stringify(canonical(data?.value)) !==
      JSON.stringify(canonical(record.value))
  )
    throw new Error(
      'Imported record verification failed. No source data was deleted.',
    );
}
console.log(
  `Verified ${records.length} records in PostgreSQL. The original Blobs and private backup are retained.`,
);
