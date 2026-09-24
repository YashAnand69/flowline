# Flowline

[![Flowline CI](https://github.com/YashAnand69/flowline/actions/workflows/ci.yml/badge.svg)](https://github.com/YashAnand69/flowline/actions/workflows/ci.yml)

**Make work flow.** An open-source workflow automation engine with a visual editor, authenticated webhooks, extensible actions, and inspectable execution history.

[Live workspace](https://flowline-yash.netlify.app) · [3D experience](https://flowline-yash.netlify.app/explore)

A React Flow workspace for getting things done, paired with an original interactive Three.js scroll experience at `/explore`.

## What works

- Google sign-in through Supabase Auth, with HttpOnly app sessions and optional recovery keys.
- Supabase PostgreSQL storage with server-only access and transactional Google/workspace linking.
- Drag-and-connect visual workflow editor, node configuration, import/export, activation and webhook-secret rotation.
- Webhook triggers, including verified GitHub HMAC-SHA256 signatures.
- JSON transforms with typed dynamic values, conditional filtering, output capture, Slack incoming webhooks, and Resend email.
- Asynchronous execution, live run inspection, input/output redaction, and exponential retries for transient provider failures.
- Safe preview runs: data processing is real, external messages are previews.
- AES-256-GCM encrypted integration credentials.
- Responsive interface, keyboard-accessible dialogs, reduced-motion support, lazy-loaded 3D rendering and a WebGL fallback.
- One-command Docker startup with Postgres and Redis/BullMQ.

## Quick start

Requires Node.js 24+.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:3001`. For local development, run the API on port 4317 (`PORT=4317 npm start`) and `npm run dev` in another terminal; the Vite workspace opens at `http://localhost:5173` and proxies API requests to port 4317. The local API selects the Vite origin when PORT=4317 and the standalone origin otherwise. Override APP_ORIGIN when hosting on a different domain.

The local server uses atomic file writes under `.data/`. It generates an encryption key there on first startup. Keep the data directory private and back it up along with its encryption key.

## Self-hosting

```sh
 git clone https://github.com/YashAnand69/flowline.git
 cd flowline
 docker compose up --build
```

Open `http://localhost:3001`. Compose provisions Postgres, Redis with AOF persistence, the application, and a BullMQ worker. All three data stores use named volumes. The encryption key is generated automatically and persisted in `app-data`.

For a public installation, configure `APP_ORIGIN=https://your-domain.example` and terminate HTTPS at a reverse proxy. PostgreSQL and Redis ports are private to the Docker network. Change the sample internal database credentials for an installation shared with untrusted containers. Back up the `postgres-data`, `redis-data`, and `app-data` volumes together. `docker compose down` retains data; `down -v` deletes it.

## First workflow

1. Sign in with Google on a configured installation, or open a workspace with its recovery key. Existing workspaces can connect Google from Settings.
2. Select **Capture a webhook**. Edit its transform or add your own steps.
3. Select **Test flow** and run a preview with sample JSON. Inspect each step.
4. Activate the flow and open **Webhook** to copy its URL and secret.
5. Send a JSON POST with `X-Flowline-Secret`, or configure a GitHub webhook using the displayed secret and the Issues event.
6. Follow the execution in **Executions**.

Slack and email require your own Slack incoming webhook or Resend API key and verified sender. They intentionally do not report a delivery without contacting the provider. Preview mode needs no external credentials.

## Architecture

```text
React + React Flow ── JSON API ── Storage adapter
                                  │
Signed webhook ── queued run ── execution worker ── plugin runtime
                                  │                      │
                              run history        Slack / Resend / data
```

| Capability  | Netlify                          | Self-hosted Docker                    | Local development                |
| ----------- | -------------------------------- | ------------------------------------- | -------------------------------- |
| Frontend    | Static CDN                       | Express static assets                 | Vite                             |
| API         | Netlify Function                 | Express                               | Express                          |
| Records     | Supabase PostgreSQL (Blobs fallback) | Postgres JSONB records                | Atomic JSON files                |
| Execution   | Background Functions             | BullMQ + Redis worker                 | In-process async worker          |
| Credentials | AES-256-GCM, environment key     | AES-256-GCM, persistent generated key | AES-256-GCM, local generated key |

Netlify does not run an always-on Redis worker, so its adapter uses background functions. The same validated graph engine and plugins run in all environments. See [architecture](docs/ARCHITECTURE.md), [plugin guide](docs/PLUGINS.md), and [API reference](docs/API.md).

## Netlify deployment

```sh
npx netlify login
npx netlify sites:create
# Set ENCRYPTION_KEY (64 hex characters) and RUNNER_SECRET (random 32+ bytes)
# in Netlify → Project configuration → Environment variables, production context.
# Use Functions scope if your plan supports it; otherwise use the default scopes.
npm run build
npx netlify deploy --prod --dir=dist
```

The supplied `netlify.toml` configures the SPA, API functions, security headers and Node version. Production Blobs data is scoped separately from deploy previews. Keep `ENCRYPTION_KEY` stable across deployments; replacing it makes existing saved credentials unreadable. Changing `RUNNER_SECRET` requires redeploying functions. Verify that both keys actually persist in the production context before deployment. Never prefix these values with VITE_ or place them in netlify.toml. A deployment missing its required runtime configuration returns a clear 503 instead of accepting unusable workflows.

## Google authentication and database

See [Google Auth and PostgreSQL setup](docs/GOOGLE-AUTH.md) for provider configuration, secure environment variables, workspace linking and migration from Netlify Blobs. Google sign-in is enabled only when the provider and server configuration are ready.

## Tests

```sh
npm test
npm run build
# Against a running local or Docker instance:
node tests/smoke.mjs
# Against a deployed installation:
TEST_ORIGIN=https://your-site.netlify.app node tests/smoke.mjs
```

The shared plugin contracts, graph validation, branch skipping, retry exhaustion, preview behavior, authentication, workspace isolation, recovery, signature validation, encrypted credentials and stale-edit protection are tested. CI also boots Docker Compose and runs a real webhook through Postgres and Redis to completion.

## Deliberate boundaries.

- Workspaces support 30 workflows, 30 nodes per graph, 200 runs per day and five concurrent recent runs. These application quotas are best-effort under concurrent requests; they are not a billing or hard security boundary.
- The UI returns up to 100 recent runs. History is retained; operators should implement retention for high-volume installations.
- Workflows are DAGs with exactly one webhook trigger. Conditions gate downstream nodes; a merge proceeds if any incoming branch is enabled. Multi-parent input is a map keyed by parent node IDs.
- Delivery is **at least once**, not exactly once. A provider may accept a message before a network timeout; retries or replay can produce duplicates. Use idempotent downstream systems for critical actions.
- Netlify Blobs is last-writer-wins. Version checking catches ordinary stale edits but is not an atomic compare-and-swap under simultaneous writes. The background adapter has no transaction-level execution lock. Use the Redis-backed self-hosted adapter for durable queue recovery; even there provider side effects remain at least once.
- Local in-process runs do not survive a process restart. Docker/BullMQ jobs are durable. Netlify runs use the platform’s background execution lifecycle.
- Google sign-in supports individual workspaces. There are no team roles, invitations or password reset emails. Recovery-only workspaces still require their key if all sessions are lost.
- Third-party integration OAuth, cron triggers, a plugin marketplace and SaaS billing are outside this release. Google login OAuth is supported.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New action plugins should ship with a contract test and documentation. MIT licensed.
