import type { Definition, Run, Step } from '../shared/model';
import {
  plugins,
  PluginError,
  validateNode,
  type Credentials,
  type ActionPlugin,
} from './plugins';
import { scrub } from './security';
export function validateGraph(flow: Definition) {
  const ids = new Set(flow.nodes.map((n) => n.id));
  if (ids.size !== flow.nodes.length)
    throw new PluginError('Every node needs a unique ID.');
  const triggers = flow.nodes.filter((n) => n.data.kind === 'webhook');
  if (triggers.length !== 1)
    throw new PluginError('A workflow needs exactly one webhook trigger.');
  const counts = new Map(flow.nodes.map((n) => [n.id, 0]));
  const edgePairs = new Set<string>();
  for (const edge of flow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new PluginError('A connection refers to a missing node.');
    if (edge.target === triggers[0].id)
      throw new PluginError('The trigger cannot have incoming connections.');
    const pair = edge.source + '-' + edge.target;
    if (edgePairs.has(pair)) throw new PluginError('Duplicate connection.');
    edgePairs.add(pair);
    counts.set(edge.target, counts.get(edge.target)! + 1);
  }
  if (flow.nodes.some((n) => n.id !== triggers[0].id && counts.get(n.id) === 0))
    throw new PluginError('Connect every action to the trigger.');
  const queue = flow.nodes.filter((n) => counts.get(n.id) === 0),
    order = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const e of flow.edges.filter((e) => e.source === n.id)) {
      counts.set(e.target, counts.get(e.target)! - 1);
      if (counts.get(e.target) === 0)
        queue.push(flow.nodes.find((n) => n.id === e.target)!);
    }
  }
  if (order.length !== flow.nodes.length)
    throw new PluginError(
      'Workflows cannot contain loops. Remove the circular connection.',
    );
  flow.nodes.forEach(validateNode);
  return order;
}
export async function executeRun(
  run: Run,
  credentials: Credentials,
  persist: (r: Run) => Promise<void>,
  options: {
    sleep?: (ms: number) => Promise<void>;
    fetcher?: typeof fetch;
    registry?: typeof plugins;
  } = {},
) {
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const registry = options.registry ?? plugins;
  const values: Record<string, unknown> = {};
  const enabled = new Map<string, boolean>();
  run.status = 'running';
  run.steps = [];
  await persist(run);
  try {
    for (const node of validateGraph(run.definition)) {
      const parents = run.definition.edges
        .filter((e) => e.target === node.id)
        .map((e) => e.source);
      const allowed =
        node.data.kind === 'webhook' || parents.some((p) => enabled.get(p));
      const input =
        parents.length === 1
          ? values[parents[0]]
          : parents.length > 1
            ? Object.fromEntries(parents.map((p) => [p, values[p]]))
            : run.input;
      const step: Step = {
        nodeId: node.id,
        label: node.data.label,
        kind: node.data.kind,
        status: allowed ? 'running' : 'skipped',
        attempts: 0,
        startedAt: new Date().toISOString(),
        input: scrub(input),
      };
      run.steps.push(step);
      await persist(run);
      if (!allowed) {
        enabled.set(node.id, false);
        continue;
      }
      const start = Date.now();
      let complete = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        step.attempts = attempt;
        step.status = 'running';
        await persist(run);
        try {
          const result = await (
            registry[node.data.kind] as ActionPlugin
          ).execute(node.data.config, {
            input,
            trigger: run.input,
            steps: values,
            credentials,
            dryRun: run.dryRun,
            fetcher: options.fetcher ?? fetch,
          });
          values[node.id] = result.output;
          enabled.set(node.id, result.continue !== false);
          step.output = scrub(result.output);
          step.status = 'success';
          complete = true;
          break;
        } catch (error) {
          const err = error as Error;
          step.error = err.message;
          if (error instanceof PluginError && error.retryable && attempt < 3) {
            step.status = 'retrying';
            await persist(run);
            await sleep(500 * 2 ** (attempt - 1));
          } else {
            step.status = 'failed';
            throw error;
          }
        }
      }
      if (complete) delete step.error;
      step.finishedAt = new Date().toISOString();
      step.durationMs = Date.now() - start;
      await persist(run);
    }
    run.status = 'success';
  } catch (error) {
    run.status = 'failed';
    run.error = (error as Error).message;
    const step = run.steps.at(-1);
    if (step) {
      step.status = 'failed';
      step.finishedAt = new Date().toISOString();
      step.durationMs = Date.now() - Date.parse(step.startedAt);
    }
  }
  run.finishedAt = new Date().toISOString();
  await persist(run);
  return run;
}
