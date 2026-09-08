import type { Config, Context } from '@netlify/functions';
import { BlobStorage } from '../../server/storage';
import { handleApi } from '../../server/api';
export default async (req: Request, context: Context) => {
  const scope =
    context.deploy.context === 'production' ? 'production' : context.deploy.id;
  const store = new BlobStorage(scope);
  return handleApi(req, {
    store,
    encryptionKey: Netlify.env.get('ENCRYPTION_KEY') || '',
    dispatch: async (run) => {
      const secret = Netlify.env.get('RUNNER_SECRET');
      if (!secret) throw new Error('Runner is not configured.');
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
      if (!response.ok) throw new Error('Worker did not accept the execution.');
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
