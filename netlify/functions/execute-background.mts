import type { Context } from '@netlify/functions';
import { BlobStorage } from '../../server/storage';
import { SupabaseStorage } from '../../server/supabase-storage';
import { credentialsFor } from '../../server/api';
import { executeRun } from '../../server/engine';
import { equal } from '../../server/security';
import type { Run } from '../../shared/model';
export default async (req: Request, context: Context) => {
  const secret = Netlify.env.get('RUNNER_SECRET');
  if (
    !secret ||
    !equal(req.headers.get('authorization') || '', `Bearer ${secret}`)
  )
    return new Response(null, { status: 401 });
  const { owner, id } = (await req.json()) as { owner: string; id: string };
  if (!/^[a-f0-9-]{36}$/.test(owner) || !/^[a-f0-9-]{36}$/.test(id))
    return new Response(null, { status: 400 });
  const scope =
    context.deploy.context === 'production' ? 'production' : context.deploy.id;
  const url = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_SECRET_KEY');
  const store =
    url && key ? new SupabaseStorage(url, key, scope) : new BlobStorage(scope);
  const run = await store.get<Run>(`runs/${owner}/${id}`);
  if (!run || run.status !== 'queued') return;
  await executeRun(
    run,
    await credentialsFor(store, owner, Netlify.env.get('ENCRYPTION_KEY') || ''),
    (r) => store.set(`runs/${owner}/${id}`, r),
  );
};
