# Google sign-in and PostgreSQL

Flowline supports Google sign-in through Supabase Auth and server-only PostgreSQL storage through Supabase's Data API. Deploying the code alone does not configure Google's provider: complete the setup below before enabling `GOOGLE_AUTH_ENABLED`.

## Provider setup

1. Apply `supabase/migrations/20260909022934_flowline_database_and_google_accounts.sql` to your dedicated Supabase project.
2. In Google Auth Platform, create a Web application OAuth client. Use only `openid`, `email`, and `profile` scopes.
3. Set the authorized JavaScript origin to your app origin. The hosted Flowline origin is `https://flowline-yash.netlify.app`.
4. Set Google's authorized redirect URI to `https://<supabase-project-ref>.supabase.co/auth/v1/callback`.
5. In Supabase Authentication → Sign In / Providers → Google, enable Google and save the client ID and client secret.
6. Set Supabase Authentication → URL Configuration → Site URL to the app origin. Add `https://flowline-yash.netlify.app/api/auth/callback` to the redirect allow list. Avoid wildcards in production.
7. Configure server environment variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GOOGLE_AUTH_ENABLED=true`. Keep `ENCRYPTION_KEY` and `RUNNER_SECRET` unchanged. Redeploy functions after changes.
8. Complete a real Google login, sign out, sign back in, and confirm the same workspace reopens. For a testing-mode Google app, add authorized test users; publish Google's audience before inviting the general public.

The Google client secret lives in Supabase's provider settings. The Supabase secret key lives only in server configuration. No Google or Supabase credential is bundled into the frontend. Do not use `VITE_` prefixes.

## Existing workspaces

An existing browser session or recovery key still opens the existing workspace. Settings → Connect Google account links that workspace after explicit user action and Google verification. The callback requires the same workspace session that initiated linking. Each Google account maps to one workspace and each workspace to one Google account; conflicting links are rejected rather than merging or overwriting data.

New Google users receive a workspace automatically. They may generate an optional recovery key in Settings. Signing out deletes the current Flowline session. Recovery keys grant workspace access independently of Google; keep them private and rotate a compromised key.

## Security model

- Google authentication uses PKCE and a 10-minute encrypted HttpOnly, SameSite=Lax cookie scoped to `/api/auth`.
- The callback exchanges the one-use code and verifies the user against Supabase Auth. Verified Google identity and verified email are required. User-editable metadata is only used for display names.
- Server-verified user IDs drive database bindings. A transaction, lock and unique constraints protect identity/workspace linking.
- Flowline then issues its own opaque, HttpOnly application session, expiring after 30 days. Provider and refresh tokens are discarded. Signing out of Google elsewhere does not invalidate an already-issued Flowline session; use Flowline Sign out on the device.
- Database tables have RLS enabled and grants revoked from `anon` and `authenticated`. All app data goes through the authenticated Flowline API. The binding function is `SECURITY INVOKER` and executable only by `service_role`.
- Supabase's informational `rls_enabled_no_policy` notice is expected for these server-only tables: there are intentionally no browser-access policies.
- Production and preview records are separated by `scope`. Local Supabase-backed development defaults to `development`.

## Migrate from Netlify Blobs

Pause writes briefly by setting `MIGRATION_READ_ONLY=true` and redeploying the API. Wait until previously queued/running executions complete. Keep the existing encryption key.

Run `scripts/migrate-netlify-blobs.mjs` with `NETLIFY_CLI_PATH`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `MIGRATION_BACKUP_DIR` set in the environment. The Netlify CLI must be linked and authenticated. The script checks the source did not change during export, writes a private backup, inserts missing PostgreSQL records and verifies every value without printing it. It never deletes Blobs or overwrites existing database records.

Set the Supabase server variables, remove `MIGRATION_READ_ONLY`, and redeploy API and background functions together. Verify `/api/health` reports `supabase-postgres`, existing sessions open the same workflows, and `tests/smoke.mjs` passes against production. Keep Blobs and the private backup until the migration is accepted. Do not point a preview deployment at the production scope.
