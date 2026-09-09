import { createClient } from '@supabase/supabase-js';
import { seal, unseal } from './security';

export type GoogleConfig = { url: string; publishableKey: string };
export type GoogleProfile = { id: string; email: string; name: string };
type Pending = {
  storage: Record<string, string>;
  expires: number;
  workspaceId?: string;
};
const cookieName = 'flowline_oauth';
function client(config: GoogleConfig, storage: Record<string, string>) {
  return createClient(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      storage: {
        getItem: (key) => storage[key] ?? null,
        setItem: (key, value) => {
          storage[key] = value;
        },
        removeItem: (key) => {
          delete storage[key];
        },
      },
    },
  });
}
export function oauthCookie(value: string, secure: boolean) {
  return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${value ? 600 : 0}${secure ? '; Secure' : ''}`;
}
export async function beginGoogle(
  config: GoogleConfig,
  origin: string,
  encryptionKey: string,
  workspaceId?: string,
) {
  const pending: Pending = {
    storage: {},
    expires: Date.now() + 600_000,
    workspaceId,
  };
  const supabase = client(config, pending.storage);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/api/auth/callback`,
      skipBrowserRedirect: true,
      scopes: 'openid email profile',
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error || !data.url)
    throw new Error('Google sign-in could not be started.');
  return {
    url: data.url,
    cookie: oauthCookie(
      seal(pending, encryptionKey),
      origin.startsWith('https:'),
    ),
  };
}
export async function finishGoogle(
  config: GoogleConfig,
  req: Request,
  encryptionKey: string,
) {
  const encrypted = req.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)flowline_oauth=([^;]+)/)?.[1];
  const code = new URL(req.url).searchParams.get('code');
  if (!encrypted || !code || code.length > 2048)
    throw new Error('Restart Google sign-in in this browser.');
  const pending = unseal<Pending>(encrypted, encryptionKey);
  if (!pending || pending.expires < Date.now())
    throw new Error('Google sign-in expired. Please try again.');
  const supabase = client(config, pending.storage);
  const { data: session, error } =
    await supabase.auth.exchangeCodeForSession(code);
  if (error || !session.session)
    throw new Error('Google sign-in could not be verified.');
  const { data, error: userError } = await supabase.auth.getUser(
    session.session.access_token,
  );
  const user = data.user;
  if (
    userError ||
    !user?.email ||
    !user.email_confirmed_at ||
    !user.identities?.some((i) => i.provider === 'google')
  ) {
    throw new Error('A verified Google account is required.');
  }
  // Profile metadata is display-only. Authorization uses the server-verified user ID.
  const profile: GoogleProfile = {
    id: user.id,
    email: user.email,
    name: String(
      user.user_metadata?.full_name || user.email.split('@')[0],
    ).slice(0, 60),
  };
  // Flowline owns its HttpOnly app session; do not retain provider or refresh tokens.
  await supabase.auth.signOut({ scope: 'local' });
  return { profile, workspaceId: pending.workspaceId };
}
