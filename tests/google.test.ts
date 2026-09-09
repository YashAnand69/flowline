import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginGoogle, finishGoogle } from '../server/google';
import { unseal, seal } from '../server/security';
import { handleApi, type Environment } from '../server/api';
import { MemoryStorage } from '../server/storage';
const config = {
  url: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_test',
};
const key = 'a'.repeat(64),
  origin = 'https://flowline.test';
const profileId = 'a5a0abf1-7c6a-4c0d-9731-f9f5d8141d04';
const user = {
  id: profileId,
  aud: 'authenticated',
  email: 'test@example.com',
  email_confirmed_at: new Date().toISOString(),
  identities: [
    {
      provider: 'google',
      id: profileId,
      user_id: profileId,
      identity_data: {},
    },
  ],
  user_metadata: { full_name: 'Test Builder', sub: 'untrusted-metadata-id' },
  app_metadata: { provider: 'google' },
  created_at: new Date().toISOString(),
};
function request(cookie: string, code = 'valid-code') {
  return new Request(`${origin}/api/auth/callback?code=${code}`, {
    headers: { cookie },
  });
}
test('Google OAuth uses PKCE and an encrypted, short-lived HttpOnly state cookie', async () => {
  const pending = await beginGoogle(config, origin, key, 'existing-workspace');
  const url = new URL(pending.url);
  assert.equal(url.origin, config.url);
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.equal(
    url.searchParams.get('redirect_to'),
    origin + '/api/auth/callback',
  );
  assert.match(
    pending.cookie,
    /HttpOnly; SameSite=Lax; Path=\/api\/auth; Max-Age=600; Secure/,
  );
  assert.ok(!pending.cookie.includes('existing-workspace'));
  const state = unseal<any>(
    pending.cookie.split(';')[0].slice('flowline_oauth='.length),
    key,
  );
  assert.equal(state.workspaceId, 'existing-workspace');
  assert.ok(
    Object.keys(state.storage).some((k) => k.endsWith('-code-verifier')),
  );
});
test('OAuth callback rejects missing, tampered and expired state before contacting the provider', async () => {
  await assert.rejects(finishGoogle(config, request(''), key));
  await assert.rejects(
    finishGoogle(config, request('flowline_oauth=invalid'), key),
  );
  const expired = seal({ storage: {}, expires: 0 }, key);
  await assert.rejects(
    finishGoogle(config, request('flowline_oauth=' + expired), key),
    /expired/,
  );
});
test('OAuth exchanges the verifier, checks the user on the auth server and discards provider tokens', async (t) => {
  const pending = await beginGoogle(config, origin, key);
  const calls: string[] = [];
  const jwt = [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        sub: profileId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url'),
    'signature',
  ].join('.');
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/token?')) {
        const body = JSON.parse(init?.body as string);
        assert.equal(body.auth_code, 'valid-code');
        assert.ok(body.code_verifier.length >= 43);
        return Response.json({
          access_token: jwt,
          refresh_token: 'sensitive-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          user,
        });
      }
      if (url.includes('/user')) return Response.json(user);
      if (url.includes('/logout')) return new Response(null, { status: 204 });
      throw new Error('Unexpected provider call');
    },
  );
  const result = await finishGoogle(
    config,
    request(pending.cookie.split(';')[0]),
    key,
  );
  assert.equal(result.profile.id, profileId);
  assert.equal(result.profile.email, user.email);
  assert.ok(calls.some((url) => url.includes('/user')));
  assert.ok(!JSON.stringify(result).includes('refresh-token'));
});
test('OAuth API requires authentication to link and rejects cross-origin login requests', async () => {
  const store = Object.assign(new MemoryStorage(), {
    bindGoogle: async () => {
      throw new Error('Not expected');
    },
  });
  const env: Environment = {
    store,
    encryptionKey: key,
    google: config,
    dispatch: async () => {},
  };
  const call = (body: unknown, extra = {}) =>
    handleApi(
      new Request(origin + '/api/auth/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...extra },
        body: JSON.stringify(body),
      }),
      env,
    );
  assert.equal((await call({ link: true })).status, 401);
  assert.equal((await call({}, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await call({})).status, 200);
  const invalid = await handleApi(request(''), env);
  assert.equal(invalid.status, 303);
  assert.equal(invalid.headers.get('location'), origin + '/?auth_error=google');
  assert.match(invalid.headers.get('set-cookie')!, /Max-Age=0/);
});
