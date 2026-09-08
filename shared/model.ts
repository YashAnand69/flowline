import { z } from 'zod';
export const kinds = [
  'webhook',
  'transform',
  'filter',
  'log',
  'slack',
  'email',
] as const;
export type Kind = (typeof kinds)[number];
export const nodeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  type: z.literal('flowNode').default('flowNode'),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: z.object({
    kind: z.enum(kinds),
    label: z.string().min(1).max(100),
    config: z.record(z.string(), z.unknown()).default({}),
  }),
});
export const edgeSchema = z.object({
  id: z.string().max(150),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});
export const workflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  active: z.boolean().default(false),
  nodes: z.array(nodeSchema).min(1).max(30),
  edges: z.array(edgeSchema).max(60),
});
export type FlowNode = z.infer<typeof nodeSchema>;
export type FlowEdge = z.infer<typeof edgeSchema>;
export type Definition = z.infer<typeof workflowSchema>;
export type Workflow = Definition & {
  id: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  webhookSecret: string;
  version: number;
};
export type Step = {
  nodeId: string;
  label: string;
  kind: Kind;
  status: 'running' | 'retrying' | 'success' | 'failed' | 'skipped';
  attempts: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
};
export type Run = {
  id: string;
  workflowId: string;
  workflowName: string;
  owner: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  source: 'manual' | 'webhook';
  createdAt: string;
  finishedAt?: string;
  steps: Step[];
  input: unknown;
  error?: string;
  definition: Workflow;
  dryRun: boolean;
};
export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  recoveryHash: string;
};
export const pluginInfo: Record<
  Kind,
  { name: string; category: string; description: string; color: string }
> = {
  webhook: {
    name: 'Webhook',
    category: 'Trigger',
    description: 'Start a flow with an HTTP event or a GitHub webhook.',
    color: '#d2e9b8',
  },
  transform: {
    name: 'Transform',
    category: 'Data',
    description: 'Shape data using JSON and dynamic values.',
    color: '#dcd5f4',
  },
  filter: {
    name: 'Condition',
    category: 'Logic',
    description: 'Continue only when a value matches your rule.',
    color: '#f4e2ba',
  },
  log: {
    name: 'Capture output',
    category: 'Utility',
    description: 'Save structured output in your execution history.',
    color: '#cde5e5',
  },
  slack: {
    name: 'Slack',
    category: 'Action',
    description: 'Post a message to a connected Slack channel.',
    color: '#eed5e4',
  },
  email: {
    name: 'Email',
    category: 'Action',
    description: 'Deliver a transactional email with Resend.',
    color: '#d2dff6',
  },
};
export function makeTemplate(index = 0): Definition {
  const node = (
    id: string,
    kind: Kind,
    label: string,
    x: number,
    config: Record<string, unknown> = {},
  ): FlowNode => ({
    id,
    type: 'flowNode',
    position: { x, y: 160 },
    data: { kind, label, config },
  });
  const nodes =
    index === 1
      ? [
          node('trigger', 'webhook', 'New GitHub issue', 70),
          node('filter', 'filter', 'Only opened issues', 370, {
            field: '{{trigger.action}}',
            operator: 'equals',
            value: 'opened',
          }),
          node('slack', 'slack', 'Notify the team', 670, {
            message:
              'New issue: {{trigger.issue.title}}\n{{trigger.issue.html_url}}',
          }),
        ]
      : index === 2
        ? [
            node('trigger', 'webhook', 'New lead received', 70),
            node('email', 'email', 'Send a warm welcome', 420, {
              to: '{{trigger.email}}',
              subject: 'Welcome, {{trigger.name}}!',
              body: 'Hi {{trigger.name}},\nThanks for joining us. We’re happy you’re here.',
            }),
          ]
        : [
            node('trigger', 'webhook', 'An event arrives', 70),
            node('transform', 'transform', 'Make it useful', 370, {
              json: '{\n  "name": "{{trigger.name}}",\n  "email": "{{trigger.email}}",\n  "message": "Welcome to Flowline, {{trigger.name}}!"\n}',
            }),
            node('log', 'log', 'Capture the result', 670),
          ];
  return {
    name:
      ['My first flow', 'GitHub issue → Slack', 'Welcome new leads'][index] ||
      'Untitled workflow',
    description:
      [
        'Receive an event, shape the data, and capture the result.',
        'Keep your team informed when a GitHub issue is opened.',
        'A personal welcome, delivered automatically.',
      ][index] || '',
    active: false,
    nodes,
    edges: nodes
      .slice(1)
      .map((n, i) => ({
        id: `e-${nodes[i].id}-${n.id}`,
        source: nodes[i].id,
        target: n.id,
      })),
  };
}
export const samplePayload = {
  name: 'Alex Morgan',
  email: 'alex@example.com',
  action: 'opened',
  issue: {
    title: 'Make work flow',
    html_url: 'https://github.com/example/project/issues/1',
  },
};
