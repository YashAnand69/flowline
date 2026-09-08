# Architecture and operational guarantees

The UI serializes React Flow nodes and edges into a schema-validated definition. The API authenticates an HttpOnly session, scopes records by workspace, validates the DAG and configuration, and snapshots the definition into each run. Later edits do not change an already-queued run.

## State machine

`queued → running → success | failed`

Each step independently moves through `running → retrying → running → success | failed`, or `skipped`. Transient HTTP 429/5xx or network failures receive up to three attempts, with delays of 500 ms then 1000 ms. Requests time out after 10 seconds. Errors are persisted with the relevant step and final run.

Topological ordering rejects loops, unreachable nodes, missing references and incoming edges to the trigger. Parallel branches are traversed sequentially in dependency order; this release favors inspectability over parallel node execution. A false condition disables its descendants unless another enabled parent reaches a merge.

## Persistence

The Storage interface supplies get, set, delete and prefix-list. Local files are written through temporary-file rename. Postgres uses a parameterized JSONB record table. Netlify uses a strong-consistency site-scoped Blobs store, with production isolated from previews. Each run gets its own record, avoiding lost appends to a shared history list.

## Execution adapters

- Local development dispatches work asynchronously inside the process.
- Docker adds jobs to BullMQ. Redis AOF retains the queue, and BullMQ recovers stalled jobs after worker restart. A completed/failed run is not executed again by the local worker.
- Netlify dispatches an authenticated internal request to a background function. The internal secret is stored in function environment variables. The worker only accepts queued records and persists step state after changes. Netlify Blobs has no atomic execution lock: concurrent duplicate invocations remain a limitation.

No adapter promises exactly-once external side effects. Design downstream systems for idempotency when duplicates matter.

## Security boundaries

Session tokens and recovery keys are generated from 32 cryptographically random bytes. Only their SHA-256 hashes are stored in lookup records. Sessions expire after 30 days; recovery rotation revokes the previous recovery key. Recovery keys grant all workspace privileges and are shown on creation or rotation.

All authenticated records are scoped to the current workspace. The public webhook resolves its workflow owner through an internal pointer and requires either its secret header or a constant-time verified GitHub HMAC-SHA256 signature over the raw body. Mutating browser requests reject cross-origin Origin headers. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS.

Credentials use AES-256-GCM with an installation encryption key. Integration reads return connection metadata, never ciphertext or plaintext. Dynamic expressions cannot traverse prototype fields or execute code. The two outbound providers use fixed HTTPS destinations; Slack accepts only canonical incoming-webhook URLs. Requests reject redirects and have timeouts. Run payloads are scrubbed when exposed to the browser, including sensitive key names. Arbitrary secrets hidden under innocent field names cannot be reliably detected; avoid including secrets in event payloads.

API payloads are limited to 64 KB. Netlify applies an IP/domain rate limit. Application quotas are best-effort under concurrency. Local deployments should configure reverse-proxy rate limits for an untrusted public audience.

## Scaling boundaries

Records are prefix-listed for workflow/run queries. This is appropriate for a small self-hosted team and a portfolio release, not a large multi-tenant event platform. At scale, use dedicated relational tables, indexed pagination, durable idempotency keys, an outbox, transactional leases, retention jobs and provider-specific rate-limit scheduling. These are not claimed to be implemented.
