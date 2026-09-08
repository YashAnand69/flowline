# Writing a Flowline plugin

Plugins are explicit server-side TypeScript modules, not arbitrary user-uploaded code. They run with the server's privileges; only install trusted plugins.

## Contract

```ts
interface ActionPlugin {
  kind: Kind;
  validate(config: Record<string, unknown>): void;
  execute(
    config: Record<string, unknown>,
    context: PluginContext,
  ): Promise<{ output: unknown; continue?: boolean }>;
}
```

`context` contains the trigger payload, upstream input, a map of completed step outputs, decrypted integration credentials, the `dryRun` flag and an injectable `fetcher`.

- `validate` must reject invalid settings before activation or execution.
- `execute` returns JSON-serializable output. Returning `continue: false` gates descendants.
- Honor `dryRun`: external side effects must become labeled previews.
- Throw `PluginError(message, true)` only for transient errors safe to retry. Permanent configuration errors must not retry.
- Use bounded network timeouts and reject redirects where credentials could be exposed.
- Never place credentials in output, logs, configuration exports or provider error messages.

## Add an action

1. Add its kind and descriptive metadata in `shared/model.ts`.
2. Implement it in `server/plugins.ts` and register it in `plugins`.
3. Add a node icon in `app/ui.tsx` and configuration fields in `app/Editor.tsx`.
4. If it needs credentials, add validated encrypted credential handling in `server/api.ts` and an integration form in the workspace.
5. Extend the shared contract loop in `tests/engine.test.ts` with valid configuration and a preview assertion. Add provider-specific failure and retry tests using an injected fetcher.
6. Run `npm test` and `npm run build`.

A transform is a small reference implementation. Slack and email demonstrate bounded, credentialed delivery with preview support.

## Trigger contract

The built-in webhook trigger implements `subscribe(workflowId, origin)` and returns a POST endpoint plus the required authentication method. A future push trigger can provision a provider subscription through its own trusted connector; cron scheduling is not implemented in this release.

## Data expressions

`interpolate(value, context)` traverses JSON and resolves `{{trigger.field}}`, `{{input.field}}` and `{{steps.node_id.field}}`. A whole-value expression preserves the source type; embedded expressions become text. Prototype keys are blocked. No JavaScript execution is supported.
