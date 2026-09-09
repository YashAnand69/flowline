# JSON API

All browser endpoints are under `/api`, return `Cache-Control: no-store`, and require the HttpOnly workspace session except `/health`, session creation/restoration and authenticated public webhooks. JSON bodies are capped at 64 KB.

| Method             | Path                           | Action                                                 |
| ------------------ | ------------------------------ | ------------------------------------------------------ |
| GET                | `/health`                      | Check service and storage availability                 |
| POST               | `/session`                     | `{}` creates a workspace; `{recoveryKey}` restores one |
| GET                | `/session`                     | Read current workspace metadata                        |
| DELETE             | `/session`                     | Revoke current session                                 |
| PATCH              | `/workspace`                   | Rename workspace with `{name}`                         |
| POST               | `/recovery`                    | Rotate recovery key; returns new key once              |
| GET / POST         | `/workflows`                   | List or create a graph                                 |
| GET / PUT / DELETE | `/workflows/:id`               | Read, versioned update or delete                       |
| POST               | `/workflows/:id/run`           | Queue `{input, dryRun}`                                |
| POST               | `/workflows/:id/rotate-secret` | Replace webhook secret                                 |
| GET                | `/runs`                        | Latest 100 execution records                           |
| GET                | `/runs/:id`                    | Inspect one execution                                  |
| GET                | `/integrations`                | Connection metadata only                               |
| PUT / DELETE       | `/integrations/slack`          | Save `{url}` or disconnect                             |
| PUT / DELETE       | `/integrations/email`          | Save `{apiKey, from}` or disconnect                    |
| POST               | `/hooks/:workflowId`           | Queue an active workflow with a JSON event             |

Webhook authorization accepts `X-Flowline-Secret: <workflow secret>` or `X-Hub-Signature-256: sha256=<HMAC digest>` using the raw request body and workflow secret. Inactive workflows return 409. Invalid signatures return 401. Queue acceptance returns 202 with the run ID, not a promise that downstream delivery already succeeded.

Errors use `{error: "Readable explanation"}`. Missing workspace resources return 404. Stale workflow versions return 409. Quotas return 429. Worker dispatch failure returns 503 and persists a failed run.

Workflow exports contain name, description, active=false, nodes and edges; import always produces a new paused workflow with a fresh secret. See `shared/model.ts` for the complete graph schema.

## Google authentication

- `GET /api/auth/config`: returns Google availability and the configured database type; no secrets.
- `POST /api/auth/google` with `{}`: starts PKCE login, sets an encrypted HttpOnly cookie and returns the provider URL.
- `POST /api/auth/google` with `{"link":true}`: requires the current workspace session and starts explicit Google linking.
- `GET /api/auth/callback?code=...`: exchanges the code, verifies the Google user, binds the workspace and sets an application session. Returns a fixed same-origin redirect.
- `GET /api/session`: includes a display-only `workspace.account` object for Google-linked workspaces.
- `DELETE /api/session`: invalidates the current application session.

See [Google authentication](GOOGLE-AUTH.md) for provider setup and security details.
