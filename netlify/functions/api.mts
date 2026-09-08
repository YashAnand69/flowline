import type { Config, Context } from '@netlify/functions';
import { BlobStorage } from '../../server/storage';
import { handleApi } from '../../server/api';
export default async (req: Request, context: Context) => {
  const scope =
    context.deploy.context === 'production' ? 'production' : context.deploy.id;
  const store = new BlobStorage(scope);
  const encryptionKey = Netlify.env.get('ENCRYPTION_KEY') || '';
  const runnerSecret = Netlify.env.get('RUNNER_SECRET') || '';
  if (!encryptionKey || !runnerSecret) {
    console.error('Flowline configuration incomplete', {
      deployContext: context.deploy.context,
      encryptionConfigured: Boolean(encryptionKey),
      runnerConfigured: Boolean(runnerSecret),
    });
    return Response.json(
      { error: 'The server is being configured. Please try again shortly.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return handleApi(req, {
    store,
    encryptionKey,
    dispatch: async (run) => {
      const secret = runnerSecret;
      const origin = new URL(req.url).origin;
      const response = await fetch(
        `${origin}/.netlify/functions/execute-background`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({ owner: run.owner, id: run.id }),
        },
      );
      if (!response.ok) {
        console.error('Worker dispatch rejected', { status: response.status });
        throw new Error('Worker did not accept the execution.');
      }
    },
  });
};
export const config: Config = {
  path: '/api/*',
  rateLimit: {
    windowSize: 60,
    windowLimit: 120,
    aggregateBy: ['ip', 'domain'],
  },
};
