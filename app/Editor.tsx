import { useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
  type NodeProps,
  type Node,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Plus,
  Save,
  Play,
  Webhook,
  X,
  Trash2,
  Copy,
  Download,
  RotateCcw,
  Settings2,
  ChevronRight,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Workflow, FlowNode, Kind, Run } from '../shared/model';
import { pluginInfo, samplePayload, kinds } from '../shared/model';
import { api, post, download } from './client';
import { NodeIcon, Modal, Field, Status } from './ui';
function FlowNodeView({ data, selected }: NodeProps<Node<FlowNode['data']>>) {
  return (
    <div className={`flow-node ${selected ? 'selected' : ''}`}>
      <div className="node-topline">
        <span
          className="node-icon"
          style={{ background: pluginInfo[data.kind].color }}
        >
          <NodeIcon kind={data.kind} />
        </span>
        <div>
          <small>{pluginInfo[data.kind].category}</small>
          <strong>{data.label}</strong>
        </div>
        <span className="node-menu">···</span>
      </div>
      <div className="node-bottom">
        {data.kind === 'webhook'
          ? 'Listening for an event'
          : pluginInfo[data.kind].name}
        <span className="node-port-dot" />
      </div>
      {data.kind !== 'webhook' && (
        <Handle type="target" position={Position.Left} />
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { flowNode: FlowNodeView };
export default function Editor({
  workflow,
  onBack,
  onSaved,
  onRun,
}: {
  workflow: Workflow;
  onBack: () => void;
  onSaved: (w: Workflow) => void;
  onRun: (r: Run) => void;
}) {
  const [flow, setFlow] = useState(workflow),
    [selected, setSelected] = useState<string | null>(null),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [addOpen, setAddOpen] = useState(false),
    [testOpen, setTestOpen] = useState(false),
    [hookOpen, setHookOpen] = useState(false),
    [payload, setPayload] = useState(JSON.stringify(samplePayload, null, 2)),
    [dryRun, setDryRun] = useState(true),
    [running, setRunning] = useState(false),
    [leaveOpen, setLeaveOpen] = useState(false);
  const selectNode = flow.nodes.find((n) => n.id === selected);
  const update = (fn: (f: Workflow) => Workflow) => {
    setFlow(fn);
    setDirty(true);
  };
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);
  const nodesChange = useCallback((changes: NodeChange[]) => {
    setFlow((f) => ({
      ...f,
      nodes: applyNodeChanges(changes, f.nodes) as FlowNode[],
    }));
    if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions'))
      setDirty(true);
  }, []);
  const edgesChange = useCallback((changes: EdgeChange[]) => {
    setFlow((f) => ({ ...f, edges: applyEdgeChanges(changes, f.edges) }));
    if (changes.some((c) => c.type !== 'select')) setDirty(true);
  }, []);
  const connect = useCallback((connection: Connection) => {
    setFlow((f) => ({ ...f, edges: addEdge(connection, f.edges) }));
    setDirty(true);
  }, []);
  async function save(next = flow) {
    setSaving(true);
    try {
      const { workflow: w } = await api<{ workflow: Workflow }>(
        `workflows/${flow.id}`,
        { method: 'PUT', body: JSON.stringify(next) },
      );
      setFlow(w);
      onSaved(w);
      setDirty(false);
      toast.success('Workflow saved');
      return w;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }
  async function run() {
    let input;
    try {
      input = JSON.parse(payload);
    } catch {
      toast.error('Test input must be valid JSON.');
      return;
    }
    setRunning(true);
    try {
      const saved = dirty ? await save() : flow;
      if (!saved) return;
      const { run: r } = await api<{ run: Run }>(
        `workflows/${flow.id}/run`,
        post({ input, dryRun }),
      );
      onRun(r);
      setTestOpen(false);
      toast.success(
        dryRun ? 'Preview execution started' : 'Live execution started',
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  function add(kind: Kind) {
    const id = `${kind}_${crypto.randomUUID().slice(0, 8)}`;
    const config: Record<string, unknown> =
      kind === 'transform'
        ? { json: '{\n  "message": "{{trigger.name}}"\n}' }
        : kind === 'filter'
          ? { field: '{{trigger.action}}', operator: 'equals', value: 'opened' }
          : kind === 'slack'
            ? { message: 'Hello {{trigger.name}}!' }
            : kind === 'email'
              ? {
                  to: '{{trigger.email}}',
                  subject: 'Welcome!',
                  body: 'Hi {{trigger.name}}, welcome aboard.',
                }
              : {};
    const last = flow.nodes.at(-1);
    const node: FlowNode = {
      id,
      type: 'flowNode',
      position: {
        x: (last?.position.x ?? 0) + 300,
        y: last?.position.y ?? 160,
      },
      data: { kind, label: pluginInfo[kind].name, config },
    };
    update((f) => ({
      ...f,
      nodes: [...f.nodes, node],
      edges: last
        ? [
            ...f.edges,
            { id: `e-${last.id}-${id}`, source: last.id, target: id },
          ]
        : f.edges,
    }));
    setSelected(id);
    setAddOpen(false);
  }
  function configChange(key: string, value: unknown) {
    update((f) => ({
      ...f,
      nodes: f.nodes.map((n) =>
        n.id === selected
          ? {
              ...n,
              data: { ...n.data, config: { ...n.data.config, [key]: value } },
            }
          : n,
      ),
    }));
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Clipboard unavailable. Select and copy the text.');
    }
  };
  return (
    <div className="editor">
      <header className="editor-header">
        <button
          className="icon-button"
          aria-label="Back to workflows"
          onClick={() => (dirty ? setLeaveOpen(true) : onBack())}
        >
          <ArrowLeft size={19} />
        </button>
        <div className="editor-title">
          <input
            aria-label="Workflow name"
            maxLength={100}
            value={flow.name}
            onChange={(e) => update((f) => ({ ...f, name: e.target.value }))}
          />
          <small>
            {dirty ? 'Unsaved changes' : 'All changes saved'} <span>·</span>{' '}
            {flow.nodes.length} nodes
          </small>
        </div>
        <div className="editor-actions">
          <label className="active-toggle">
            <Switch
              aria-label="Activate workflow"
              checked={flow.active}
              disabled={saving}
              onCheckedChange={(value) => void save({ ...flow, active: value })}
            />
            {flow.active ? 'Active' : 'Paused'}
          </label>
          <button className="button" onClick={() => setHookOpen(true)}>
            <Webhook size={16} />
            <span>Webhook</span>
          </button>
          <button
            className="button"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            <span>Save</span>
          </button>
          <button className="button primary" onClick={() => setTestOpen(true)}>
            <Play size={15} />
            <span>Test flow</span>
          </button>
        </div>
      </header>
      <div className="editor-subbar">
        <span>
          <span className="online-dot" /> VISUAL WORKFLOW EDITOR
        </span>
        <div>
          <button
            onClick={() =>
              download(`${flow.name}.json`, {
                name: flow.name,
                description: flow.description,
                active: false,
                nodes: flow.nodes,
                edges: flow.edges,
              })
            }
          >
            <Download size={14} /> Export
          </button>
          <button onClick={() => setAddOpen(true)}>
            <Plus size={15} /> Add node
          </button>
        </div>
      </div>
      <div className={`canvas-wrap ${selected ? 'has-inspector' : ''}`}>
        <ReactFlow
          nodes={flow.nodes.map((n) => ({
            ...n,
            deletable: n.data.kind !== 'webhook',
          }))}
          edges={flow.edges.map((e) => ({
            ...e,
            animated: true,
            style: { stroke: '#9bae87', strokeWidth: 1.6 },
          }))}
          nodeTypes={nodeTypes}
          onNodesChange={nodesChange}
          onEdgesChange={edgesChange}
          onConnect={connect}
          onNodeClick={(_, n) => setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={1.5}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="#cdd5c4"
          />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) =>
              pluginInfo[(n.data as FlowNode['data']).kind].color
            }
            maskColor="#e9eee280"
            pannable
            zoomable
          />
        </ReactFlow>
        <button
          className="canvas-add button primary"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={16} /> Add a step
        </button>
        <div className="canvas-hint">
          Drag to arrange <span>·</span> Connect the dots <span>·</span> Click a
          node to configure
        </div>
        {selectNode && (
          <aside className="node-inspector">
            <div className="inspector-heading">
              <span
                className="node-icon"
                style={{ background: pluginInfo[selectNode.data.kind].color }}
              >
                <NodeIcon kind={selectNode.data.kind} />
              </span>
              <div>
                <small>NODE SETTINGS</small>
                <h3>{pluginInfo[selectNode.data.kind].name}</h3>
              </div>
              <button
                className="icon-button"
                aria-label="Close node settings"
                onClick={() => setSelected(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p>{pluginInfo[selectNode.data.kind].description}</p>
            <Field label="Step name">
              <input
                value={selectNode.data.label}
                onChange={(e) =>
                  update((f) => ({
                    ...f,
                    nodes: f.nodes.map((n) =>
                      n.id === selected
                        ? { ...n, data: { ...n.data, label: e.target.value } }
                        : n,
                    ),
                  }))
                }
              />
            </Field>
            {selectNode.data.kind === 'webhook' ? (
              <div className="info-box">
                <Webhook size={18} />
                <p>
                  Send a JSON event to this workflow’s webhook URL to start a
                  live execution.
                </p>
                <button
                  className="text-button"
                  onClick={() => setHookOpen(true)}
                >
                  View endpoint <ChevronRight size={15} />
                </button>
              </div>
            ) : selectNode.data.kind === 'transform' ? (
              <Field
                label="Output JSON"
                hint="Dynamic values keep their original type when they fill an entire JSON value."
              >
                <textarea
                  className="code-input"
                  rows={10}
                  value={String(selectNode.data.config.json ?? '')}
                  onChange={(e) => configChange('json', e.target.value)}
                />
              </Field>
            ) : selectNode.data.kind === 'filter' ? (
              <>
                <Field label="Value to check">
                  <input
                    value={String(selectNode.data.config.field ?? '')}
                    onChange={(e) => configChange('field', e.target.value)}
                  />
                </Field>
                <Field label="Condition">
                  <Select
                    value={String(selectNode.data.config.operator ?? 'equals')}
                    onValueChange={(v) => configChange('operator', v)}
                  >
                    <SelectTrigger className="flow-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        ['equals', 'Equals'],
                        ['not_equals', 'Does not equal'],
                        ['contains', 'Contains'],
                        ['exists', 'Has a value'],
                        ['greater_than', 'Greater than'],
                      ].map(([v, t]) => (
                        <SelectItem key={v} value={v}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {selectNode.data.config.operator !== 'exists' && (
                  <Field label="Compare with">
                    <input
                      value={String(selectNode.data.config.value ?? '')}
                      onChange={(e) => configChange('value', e.target.value)}
                    />
                  </Field>
                )}
                <p className="hint">
                  When this condition is false, connected actions are skipped.
                </p>
              </>
            ) : selectNode.data.kind === 'slack' ? (
              <Field label="Message">
                <textarea
                  rows={7}
                  value={String(selectNode.data.config.message ?? '')}
                  onChange={(e) => configChange('message', e.target.value)}
                />
              </Field>
            ) : selectNode.data.kind === 'email' ? (
              <>
                {[
                  ['to', 'Recipient'],
                  ['subject', 'Subject'],
                  ['body', 'Email body'],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    {key === 'body' ? (
                      <textarea
                        rows={7}
                        value={String(selectNode.data.config[key] ?? '')}
                        onChange={(e) => configChange(key, e.target.value)}
                      />
                    ) : (
                      <input
                        value={String(selectNode.data.config[key] ?? '')}
                        onChange={(e) => configChange(key, e.target.value)}
                      />
                    )}
                  </Field>
                ))}
              </>
            ) : (
              <div className="info-box">
                <p>
                  This step captures the previous step’s output. Find it in the
                  execution inspector after a run.
                </p>
              </div>
            )}
            {selectNode.data.kind !== 'webhook' && (
              <div className="variables">
                <span>DYNAMIC VALUES</span>
                <code>{'{{trigger.name}}'}</code>
                <code>{'{{input.message}}'}</code>
                <small>
                  Use trigger data, the previous step’s input, or{' '}
                  {'{{steps.node_id.field}}'}.
                </small>
              </div>
            )}
            <div className="inspector-footer">
              <code>{selectNode.id}</code>
              <button
                className="danger-text"
                disabled={selectNode.data.kind === 'webhook'}
                title={
                  selectNode.data.kind === 'webhook'
                    ? 'Every flow needs its trigger'
                    : 'Remove node'
                }
                onClick={() => {
                  update((f) => ({
                    ...f,
                    nodes: f.nodes.filter((n) => n.id !== selected),
                    edges: f.edges.filter(
                      (e) => e.source !== selected && e.target !== selected,
                    ),
                  }));
                  setSelected(null);
                }}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </aside>
        )}
      </div>
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="What happens next?"
        description="Add a step. It will connect to the last node automatically."
      >
        <div className="plugin-picker">
          {kinds
            .filter((k) => k !== 'webhook')
            .map((kind) => (
              <button key={kind} onClick={() => add(kind)}>
                <span
                  className="node-icon"
                  style={{ background: pluginInfo[kind].color }}
                >
                  <NodeIcon kind={kind} />
                </span>
                <div>
                  <b>{pluginInfo[kind].name}</b>
                  <small>{pluginInfo[kind].description}</small>
                </div>
                <Plus size={16} />
              </button>
            ))}
        </div>
      </Modal>
      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        title="Give your flow a test run"
        description="Your input becomes the trigger data for this execution."
        wide
      >
        <Field label="Trigger payload (JSON)">
          <textarea
            className="code-input"
            rows={10}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
        </Field>
        <label className="preview-choice">
          <Switch
            checked={dryRun}
            onCheckedChange={setDryRun}
            aria-label="Preview external actions"
          />
          <div>
            <b>Preview external actions</b>
            <small>
              {dryRun
                ? 'Slack and email produce previews. No messages are sent.'
                : 'Live mode: configured Slack and email actions will send real messages.'}
            </small>
          </div>
        </label>
        <div className="modal-actions">
          <button className="button" onClick={() => setTestOpen(false)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={running}
            onClick={() => void run()}
          >
            {running ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Play size={16} />
            )}{' '}
            {dryRun ? 'Run preview' : 'Run live'}
          </button>
        </div>
      </Modal>
      <Modal
        open={hookOpen}
        onClose={() => setHookOpen(false)}
        title="Your webhook, ready to connect"
        description="Activate the workflow, then send an event from any application."
        wide
      >
        <Status status={flow.active ? 'active' : 'paused'} />
        <Field label="POST endpoint">
          <div className="copy-field">
            <input readOnly value={`${location.origin}/api/hooks/${flow.id}`} />
            <button
              className="icon-button"
              aria-label="Copy webhook URL"
              onClick={() =>
                void copy(`${location.origin}/api/hooks/${flow.id}`)
              }
            >
              <Copy size={16} />
            </button>
          </div>
        </Field>
        <Field
          label="Webhook secret"
          hint="Keep this private. Use it as X-Flowline-Secret, or as the GitHub webhook secret."
        >
          <div className="copy-field">
            <input readOnly type="password" value={flow.webhookSecret} />
            <button
              className="icon-button"
              aria-label="Copy webhook secret"
              onClick={() => void copy(flow.webhookSecret)}
            >
              <Copy size={16} />
            </button>
          </div>
        </Field>
        <Field label="Try it from your terminal">
          <pre>{`curl -X POST '${location.origin}/api/hooks/${flow.id}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Flowline-Secret: YOUR_SECRET' \\\n  -d '{"name":"Alex","email":"alex@example.com"}'`}</pre>
        </Field>
        <p className="hint">
          GitHub: Repository → Settings → Webhooks → Add webhook. Choose
          application/json, paste this URL and secret, and select Issues.
        </p>
        <button
          className="text-button"
          onClick={async () => {
            try {
              if (dirty && !(await save())) return;
              const { workflow: w } = await api(
                `workflows/${flow.id}/rotate-secret`,
                post({}),
              );
              setFlow(w);
              onSaved(w);
              toast.success('Secret rotated. Update your webhook sender.');
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <RotateCcw size={14} /> Rotate webhook secret
        </button>
      </Modal>
      <Modal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="Save before leaving?"
        description="Your canvas has unsaved changes."
      >
        <div className="modal-actions">
          <button className="button" onClick={onBack}>
            Discard changes
          </button>
          <button
            className="button primary"
            onClick={async () => {
              if (await save()) onBack();
            }}
          >
            Save & leave
          </button>
        </div>
      </Modal>
    </div>
  );
}
