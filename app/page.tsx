import AuthScreen, { GoogleMark, signInWithGoogle } from './AuthScreen';
import { ApiError } from './client';
import {
  useState,
  useEffect,
  lazy,
  Suspense,
  useRef,
  useCallback,
} from 'react';
import {
  ArrowUpRight,
  Plus,
  Workflow as WorkflowIcon,
  Activity,
  Blocks,
  BookOpen,
  Sparkles,
  ArrowRight,
  Search,
  GitBranch,
  Webhook,
  Mail,
  Zap,
  CircleHelp,
  Settings,
  Upload,
  MoreHorizontal,
  Trash2,
  Play,
  Check,
  Copy,
  RotateCcw,
  Loader2,
  ArrowLeft,
  RefreshCw,
  Download,
  ExternalLink,
  KeyRound,
  Lock,
  ChevronRight,
  Clock,
  ChevronDown,
  LogOut,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Sidebar, SidebarProvider } from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  type Workflow,
  type Run,
  makeTemplate,
  pluginInfo,
} from '../shared/model';
import { api, post, relative, download } from './client';
import { Modal, NodeIcon, Field, Status } from './ui';
const Editor = lazy(() => import('./Editor'));
const Explore = lazy(() => import('./Explore'));
const repo = 'https://github.com/YashAnand69/flowline';
type View =
  | 'workflows'
  | 'executions'
  | 'integrations'
  | 'templates'
  | 'docs'
  | 'settings';
type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  account?: { provider: string; email: string; name: string } | null;
};
let boot: Promise<any> | null = null;
async function bootstrap() {
  const config = await api('auth/config');
  try {
    return { ...(await api('session')), config };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401)
      return { workspace: null, config };
    throw e;
  }
}
const templates = [
  {
    title: 'Capture a webhook',
    description: 'Receive an event. Transform it. Keep the result.',
    steps: 'Webhook → Transform → Log',
    kind: 'transform' as const,
  },
  {
    title: 'Keep your team in the loop',
    description: 'Send important GitHub updates straight to Slack.',
    steps: 'Webhook → Condition → Slack',
    kind: 'slack' as const,
  },
  {
    title: 'Make a great first impression',
    description: 'Send a welcome email when a new lead arrives.',
    steps: 'Webhook → Email',
    kind: 'email' as const,
  },
];
export default function App() {
  const [view, setView] = useState<View>('workflows'),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [authConfig, setAuthConfig] = useState({
      google: false,
      database: 'local',
    }),
    [workflows, setWorkflows] = useState<Workflow[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [integrations, setIntegrations] = useState<
      { kind: string; connected: boolean; createdAt: string }[]
    >([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [editing, setEditing] = useState<Workflow | null>(null),
    [explore, setExplore] = useState(location.pathname === '/explore'),
    [createOpen, setCreateOpen] = useState(false),
    [createName, setCreateName] = useState('My first flow'),
    [creating, setCreating] = useState(false),
    [deleteId, setDeleteId] = useState<string | null>(null),
    [selectedRun, setSelectedRun] = useState<Run | null>(null),
    [recovery, setRecovery] = useState(''),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [restoreOpen, setRestoreOpen] = useState(false),
    [restoreKey, setRestoreKey] = useState(''),
    [connection, setConnection] = useState<'slack' | 'email' | null>(null),
    [credentials, setCredentials] = useState({ url: '', apiKey: '', from: '' }),
    [busy, setBusy] = useState(false),
    [workspaceName, setWorkspaceName] = useState(''),
    [disconnected, setDisconnected] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null),
    uploadRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const [flows, executions, connections] = await Promise.all([
      api('workflows'),
      api('runs'),
      api('integrations'),
    ]);
    setWorkflows(flows.workflows);
    setRuns(executions.runs);
    setIntegrations(connections.integrations);
  }, []);
  useEffect(() => {
    let alive = true;
    boot ??= bootstrap();
    boot
      .then(async (data) => {
        if (!alive) return;
        setAuthConfig(data.config);
        if (!data.workspace) return;
        setWorkspace(data.workspace);
        setWorkspaceName(data.workspace.name);
        const params = new URLSearchParams(location.search);
        if (params.has('auth_error'))
          toast.error(
            'Google could not be connected. It may already belong to another workspace.',
          );
        if (params.has('signed_in')) toast.success('Signed in with Google');
        if (params.has('auth_error') || params.has('signed_in'))
          history.replaceState({}, '', location.pathname);
        if (data.recoveryKey) {
          setRecovery(data.recoveryKey);
          setRecoveryOpen(true);
        }
        await refresh();
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setView('workflows');
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!workspace || disconnected) return;
    let stopped = false;
    const timer = setInterval(
      async () => {
        try {
          const { runs: next } = await api('runs');
          if (!stopped) {
            setRuns(next);
            setSelectedRun((current) =>
              current
                ? (next.find((r: Run) => r.id === current.id) ?? current)
                : null,
            );
          }
        } catch {
          /* keep the last successful result during transient failures */
        }
      },
      runs.some((r) => ['queued', 'running'].includes(r.status)) ? 1500 : 15000,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [
    workspace,
    disconnected,
    runs.some((r) => ['queued', 'running'].includes(r.status)),
  ]);
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => void;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      context.registerTool(
        {
          name: 'flowline_list_workflows',
          description:
            'List saved workflows in the currently authenticated workspace.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input: unknown) => {
            if (
              !input ||
              typeof input !== 'object' ||
              Object.keys(input).length
            )
              throw new Error('No parameters are accepted.');
            const result = await api('workflows');
            setWorkflows(result.workflows);
            return result.workflows.map((w: Workflow) => ({
              id: w.id,
              name: w.name,
              active: w.active,
            }));
          },
        },
        { signal: lifecycle.signal },
      );
      context.registerTool(
        {
          name: 'flowline_open_workflow',
          description:
            'Open an existing workflow in the visual editor without running it.',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input: any) => {
            if (
              !input ||
              typeof input.id !== 'string' ||
              Object.keys(input).some((k) => k !== 'id')
            )
              throw new Error('A workflow ID is required.');
            const { workflow } = await api(
              `workflows/${encodeURIComponent(input.id)}`,
            );
            setEditing(workflow);
            return { id: workflow.id, opened: true };
          },
        },
        { signal: lifecycle.signal },
      );
    } catch {
      /* WebMCP is optional */
    }
    return () => lifecycle.abort();
  }, []);
  const navigate = (next: View) => {
    setView(next);
    setSearch('');
    setFilter('all');
  };
  const saved = (flow: Workflow) => {
    setWorkflows((ws) => ws.map((w) => (w.id === flow.id ? flow : w)));
    setEditing(flow);
  };
  async function create(index = 0, name?: string) {
    setCreating(true);
    try {
      const definition = makeTemplate(index);
      if (name) definition.name = name;
      const { workflow } = await api('workflows', post(definition));
      setWorkflows((w) => [workflow, ...w]);
      setEditing(workflow);
      setCreateOpen(false);
      toast.success('Your workflow is ready to build');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function importFlow(file: File) {
    try {
      if (file.size > 65536)
        throw new Error('Workflow files must be under 64 KB.');
      const data = JSON.parse(await file.text());
      const { workflow } = await api(
        'workflows',
        post({ ...data, active: false }),
      );
      setWorkflows((w) => [workflow, ...w]);
      setEditing(workflow);
      toast.success('Workflow imported as a paused copy');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Select the text and copy it manually.');
    }
  };
  const success = runs.filter((r) => r.status === 'success').length,
    finished = runs.filter((r) =>
      ['success', 'failed'].includes(r.status),
    ).length;
  const visibleFlows = workflows.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'active' ? w.active : !w.active)),
  );
  const visibleRuns = runs.filter(
    (r) =>
      r.workflowName.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || r.status === filter),
  );
  const connected = (kind: string) => integrations.some((i) => i.kind === kind);
  const runModal = (
    <Modal
      open={!!selectedRun}
      onClose={() => setSelectedRun(null)}
      title={selectedRun?.workflowName || 'Execution'}
      description="Follow the data through every step of this run."
      wide
    >
      {selectedRun && (
        <>
          <div className="run-overview">
            <Status status={selectedRun.status} />
            <span>
              {selectedRun.dryRun ? 'Preview run' : 'Live run'} ·{' '}
              {selectedRun.source}
            </span>
            <button
              className="icon-button"
              aria-label="Download execution JSON"
              onClick={() =>
                download(`execution-${selectedRun.id}.json`, selectedRun)
              }
            >
              <Download size={16} />
            </button>
          </div>
          <div className="run-meta">
            <span>
              Started {new Date(selectedRun.createdAt).toLocaleString()}
            </span>
            <code>{selectedRun.id.slice(0, 8)}</code>
          </div>
          {selectedRun.error && (
            <div className="error-box">{selectedRun.error}</div>
          )}
          <Tabs defaultValue="steps">
            <TabsList className="run-tabs">
              <TabsTrigger value="steps">
                Steps ({selectedRun.steps.length})
              </TabsTrigger>
              <TabsTrigger value="input">Trigger input</TabsTrigger>
            </TabsList>
            <TabsContent value="input">
              <pre className="run-json">
                {JSON.stringify(selectedRun.input, null, 2)}
              </pre>
            </TabsContent>
            <TabsContent value="steps">
              <div className="run-steps">
                {selectedRun.steps.length === 0 ? (
                  <div className="waiting">
                    <Loader2 className="spin" size={22} />
                    <p>
                      {selectedRun.status === 'failed'
                        ? 'The run could not start.'
                        : 'Your execution is queued. The worker will start shortly.'}
                    </p>
                  </div>
                ) : (
                  selectedRun.steps.map((s, i) => (
                    <details
                      className="run-step"
                      key={s.nodeId}
                      open={s.status === 'failed'}
                    >
                      <summary>
                        <span className="step-number">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <NodeIcon kind={s.kind} />
                        <div>
                          <b>{s.label}</b>
                          <small>
                            {s.attempts}{' '}
                            {s.attempts === 1 ? 'attempt' : 'attempts'}{' '}
                            {s.durationMs !== undefined
                              ? `· ${s.durationMs} ms`
                              : ''}
                          </small>
                        </div>
                        <Status status={s.status} />
                        <ChevronDown size={14} />
                      </summary>
                      <div className="step-detail">
                        {s.error && <div className="error-box">{s.error}</div>}
                        <p>OUTPUT</p>
                        <pre>
                          {JSON.stringify(
                            s.output ??
                              (s.status === 'skipped'
                                ? {
                                    reason:
                                      'An upstream condition did not match.',
                                  }
                                : {}),
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    </details>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                const w = workflows.find(
                  (w) => w.id === selectedRun.workflowId,
                );
                if (w) {
                  setEditing(w);
                  setSelectedRun(null);
                } else toast.error('The source workflow was deleted.');
              }}
            >
              Open workflow <ArrowUpRight size={15} />
            </button>
          </div>
        </>
      )}
    </Modal>
  );
  if (explore)
    return (
      <>
        <Suspense
          fallback={
            <div className="loading-screen">
              <Loader2 className="spin" /> Loading experience…
            </div>
          }
        >
          <Explore
            onClose={() => {
              setExplore(false);
              history.replaceState({}, '', '/');
            }}
            onCreate={() => {
              setExplore(false);
              history.replaceState({}, '', '/');
              setCreateOpen(true);
            }}
          />
        </Suspense>
        <Toaster position="bottom-right" />
      </>
    );
  if (!workspace)
    return (
      <>
        <AuthScreen
          google={authConfig.google}
          loading={loading}
          error={
            error ||
            (new URLSearchParams(location.search).has('auth_error')
              ? 'Google sign-in was cancelled, expired, or the account is linked elsewhere. Try again, or use your recovery key.'
              : '')
          }
          onExplore={() => {
            setExplore(true);
            history.replaceState({}, '', '/explore');
          }}
          onSession={async (data) => {
            setRecovery(data.recoveryKey || '');
            setWorkspace(data.workspace);
            setWorkspaceName(data.workspace.name);
            setDisconnected(false);
            setError('');
            if (data.recoveryKey) {
              setRecovery(data.recoveryKey);
              setRecoveryOpen(true);
            }
            history.replaceState({}, '', '/');
            boot = null;
            await refresh();
          }}
        />
        <Toaster richColors position="bottom-right" />
      </>
    );
  if (editing)
    return (
      <>
        <Suspense
          fallback={
            <div className="loading-screen">
              <Loader2 className="spin" /> Opening canvas…
            </div>
          }
        >
          <Editor
            key={editing.id}
            workflow={editing}
            onBack={() => {
              setEditing(null);
              void refresh();
            }}
            onSaved={saved}
            onRun={(run) => {
              setRuns((rs) => [run, ...rs]);
              setSelectedRun(run);
            }}
          />
        </Suspense>
        {runModal}
        <Toaster richColors position="bottom-right" />
      </>
    );
  return (
    <SidebarProvider className="shell">
      <Sidebar className="sidebar" collapsible="none">
        <a className="brand" href="/" aria-label="Flowline home">
          <span className="brand-icon">
            <GitBranch />
          </span>
          flowline<span className="brand-dot">®</span>
        </a>
        <button
          className="workspace-select"
          onClick={() => navigate('settings')}
        >
          <span className="avatar">{workspace?.name.slice(0, 1) || 'P'}</span>
          <div>
            {workspace?.name || 'Personal workspace'}
            <small>Private workspace</small>
          </div>
          <span>⌄</span>
        </button>
        <p className="nav-caption">WORKSPACE</p>
        <nav>
          {(
            [
              ['workflows', WorkflowIcon, 'Workflows'],
              ['executions', Activity, 'Executions'],
              ['integrations', Blocks, 'Integrations'],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              title={label}
              aria-label={label}
              aria-current={view === key ? 'page' : undefined}
              className={view === key ? 'active' : ''}
              onClick={() => navigate(key)}
            >
              <Icon />
              {label}
              {key === 'workflows' && (
                <span>{String(workflows.length).padStart(2, '0')}</span>
              )}
            </button>
          ))}
        </nav>
        <p className="nav-caption">RESOURCES</p>
        <nav>
          <button
            title="Templates"
            aria-label="Templates"
            className={view === 'templates' ? 'active' : ''}
            onClick={() => navigate('templates')}
          >
            <Sparkles />
            Templates
          </button>
          <button
            title="Documentation"
            aria-label="Documentation"
            className={view === 'docs' ? 'active' : ''}
            onClick={() => navigate('docs')}
          >
            <BookOpen />
            Documentation
            <ArrowUpRight />
          </button>
          <button
            title="Settings"
            aria-label="Settings"
            className={view === 'settings' ? 'active' : ''}
            onClick={() => navigate('settings')}
          >
            <Settings />
            Settings
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="explore-card">
            <span className="tiny-label">A LITTLE LESS BUSYWORK.</span>
            <h3>
              A lot more
              <br />
              possibility.
            </h3>
            <button
              onClick={() => {
                setExplore(true);
                history.replaceState({}, '', '/explore');
              }}
            >
              Explore Flowline <ArrowUpRight />
            </button>
          </div>
          <button className="help-link" onClick={() => navigate('docs')}>
            <CircleHelp size={16} /> Help & documentation
          </button>
          <button className="profile" onClick={() => navigate('settings')}>
            <span className="avatar lime">{workspace?.name[0] || 'P'}</span>
            <div>
              {workspace?.account?.name || 'Your workspace'}
              <small>{workspace ? 'Saved on the server' : 'Connecting…'}</small>
            </div>
            <span className="online-dot" />
          </button>
        </div>
      </Sidebar>
      <main className="main">
        <header className="topbar">
          <span>
            Workspace <span className="muted">/</span>{' '}
            <b>{view.charAt(0).toUpperCase() + view.slice(1)}</b>
          </span>
          <div className="topbar-right">
            <span className="system-status">
              <i />
              {loading
                ? 'Connecting to your workspace'
                : error
                  ? 'Connection needs attention'
                  : 'Workspace connected'}
            </span>
            <a href={repo} target="_blank" rel="noreferrer">
              GitHub <ArrowUpRight size={14} />
            </a>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="error-box">
              {error}
              <button onClick={() => location.reload()}>
                Retry connection
              </button>
            </div>
          )}
          {disconnected ? (
            <section className="empty-state">
              <KeyRound size={35} />
              <h2>Your workspace is locked.</h2>
              <p>Restore it with your recovery key.</p>
              <button
                className="button primary"
                onClick={() => setRestoreOpen(true)}
              >
                Restore workspace
              </button>
            </section>
          ) : (
            <>
              {view === 'workflows' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">YOUR AUTOMATION STUDIO</div>
                      <h1>
                        Make work <span>flow.</span>
                      </h1>
                      <p>
                        Connect your tools. Clear your plate. Build what’s next.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      disabled={!workspace}
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus size={17} /> Create workflow
                    </button>
                  </div>
                  <section className="feature-banner">
                    <div>
                      <span className="tiny-label">
                        <span className="online-dot" /> LESS REPETITION. MORE
                        MOMENTUM.
                      </span>
                      <h2>
                        Small connections.
                        <br />
                        Extraordinary possibilities.
                      </h2>
                      <p>
                        Turn your everyday processes into effortless workflows.
                      </p>
                      <button
                        className="button white"
                        onClick={() => {
                          setExplore(true);
                          history.replaceState({}, '', '/explore');
                        }}
                      >
                        Explore the possibilities <ArrowUpRight size={18} />
                      </button>
                    </div>
                    <div className="banner-network" aria-hidden="true">
                      <div className="network-orbit" />
                      <div className="network-line" />
                      <div className="floating-node n1">
                        <Webhook />
                      </div>
                      <div className="floating-node n2">
                        <Zap />
                      </div>
                      <div className="floating-node n3">
                        <Mail />
                      </div>
                      <span className="network-caption">
                        EVERYTHING, CONNECTED.
                      </span>
                    </div>
                    <span className="banner-index">01 — ∞</span>
                  </section>
                  <div className="stats">
                    <div>
                      <span>
                        Total workflows <WorkflowIcon />
                      </span>
                      <strong>
                        {workflows.length}
                        <small>
                          {workflows.filter((w) => w.active).length} active
                          workflows
                        </small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        Successful runs <Activity />
                      </span>
                      <strong>
                        {success}
                        <small>{runs.length} recent executions</small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        Success rate <Zap />
                      </span>
                      <strong>
                        {finished
                          ? Math.round((success / finished) * 100) + '%'
                          : '—'}
                        <small>Across recent executions</small>
                      </strong>
                    </div>
                  </div>
                  <div className="section-heading">
                    <div>
                      <h2>
                        Your workflows{' '}
                        <span className="count">{workflows.length}</span>
                      </h2>
                      <p>A little logic. A lot off your plate.</p>
                    </div>
                    <div className="list-actions">
                      <button
                        className="icon-button"
                        aria-label="Import workflow JSON"
                        title="Import workflow"
                        onClick={() => uploadRef.current?.click()}
                      >
                        <Upload size={16} />
                      </button>
                      <div className="search">
                        <Search size={16} />
                        <input
                          ref={searchRef}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search workflows…"
                          aria-label="Search workflows"
                        />
                        <kbd>⌘ K</kbd>
                      </div>
                    </div>
                  </div>
                  {workflows.length > 0 && (
                    <div className="filter-buttons">
                      {['all', 'active', 'paused'].map((f) => (
                        <button
                          className={filter === f ? 'selected' : ''}
                          key={f}
                          onClick={() => setFilter(f)}
                        >
                          {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      ))}
                    </div>
                  )}
                  {loading ? (
                    <div className="waiting">
                      <Loader2 className="spin" />
                      <p>Opening your private workspace…</p>
                    </div>
                  ) : visibleFlows.length ? (
                    <div className="workflow-grid">
                      {visibleFlows.map((w) => (
                        <article className="workflow-card" key={w.id}>
                          <div className="workflow-card-top">
                            <div className="workflow-mini-nodes">
                              {w.nodes.slice(0, 4).map((n) => (
                                <span
                                  key={n.id}
                                  style={{
                                    background: pluginInfo[n.data.kind].color,
                                  }}
                                >
                                  <NodeIcon kind={n.data.kind} size={16} />
                                </span>
                              ))}
                              {w.nodes.length > 4 && (
                                <small>+{w.nodes.length - 4}</small>
                              )}
                            </div>
                            <Status status={w.active ? 'active' : 'paused'} />
                          </div>
                          <button
                            className="workflow-open"
                            onClick={() => setEditing(w)}
                          >
                            <h3>{w.name}</h3>
                            <p>
                              {w.description ||
                                `${w.nodes.length} connected steps, ready to run.`}
                            </p>
                          </button>
                          <div className="workflow-card-footer">
                            <span>
                              {w.nodes.length} steps <i>·</i> Edited{' '}
                              {relative(w.updatedAt)}
                            </span>
                            <button
                              className="icon-button"
                              aria-label={`Delete ${w.name}`}
                              onClick={() => setDeleteId(w.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Open ${w.name}`}
                              onClick={() => setEditing(w)}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-symbol">
                        <WorkflowIcon size={26} />
                      </div>
                      <h3>
                        {search || filter !== 'all'
                          ? 'No workflows match your filters.'
                          : 'Your next good idea starts here.'}
                      </h3>
                      <p>
                        {search || filter !== 'all'
                          ? 'Try another search or view all workflows.'
                          : 'Create a workflow or start with a ready-to-use template.'}
                      </p>
                      <button
                        className="button primary"
                        disabled={!workspace}
                        onClick={() =>
                          search || filter !== 'all'
                            ? (setSearch(''), setFilter('all'))
                            : setCreateOpen(true)
                        }
                      >
                        {search || filter !== 'all'
                          ? 'Clear filters'
                          : 'Create workflow'}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">SKIP THE BLANK CANVAS</div>
                      <h2>A head start, built in.</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate('templates')}
                    >
                      All templates <ArrowRight size={16} />
                    </button>
                  </div>
                  <TemplateGrid
                    disabled={!workspace || creating}
                    onCreate={create}
                  />
                </>
              )}
              {view === 'templates' && (
                <>
                  <PageHeading
                    eyebrow="FROM IDEA TO AUTOMATION"
                    title="Start a little further ahead."
                    description="Three useful starting points. Every step is yours to change."
                  />
                  <TemplateGrid
                    disabled={!workspace || creating}
                    onCreate={create}
                  />
                  <div className="info-banner">
                    <Upload size={24} />
                    <div>
                      <h3>Already have a workflow?</h3>
                      <p>Import a Flowline JSON file and make it your own.</p>
                    </div>
                    <button
                      className="button"
                      onClick={() => uploadRef.current?.click()}
                    >
                      Import workflow
                    </button>
                  </div>
                </>
              )}
              {view === 'executions' && (
                <>
                  <PageHeading
                    eyebrow="EVERY STEP, ACCOUNTED FOR"
                    title="Nothing behind the curtain."
                    description="Inspect inputs, outputs, retries, and everything in between."
                  />
                  <div className="section-heading">
                    <div className="filter-buttons">
                      {['all', 'success', 'failed', 'running', 'queued'].map(
                        (f) => (
                          <button
                            key={f}
                            className={filter === f ? 'selected' : ''}
                            onClick={() => setFilter(f)}
                          >
                            {f === 'all'
                              ? 'All executions'
                              : f[0].toUpperCase() + f.slice(1)}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search executions"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search executions…"
                      />
                    </div>
                  </div>
                  {visibleRuns.length ? (
                    <div className="execution-list">
                      <div className="execution-labels">
                        <span>WORKFLOW / RUN</span>
                        <span>STATUS</span>
                        <span>STEPS</span>
                        <span>STARTED</span>
                      </div>
                      {visibleRuns.map((r) => (
                        <button
                          className="execution-row"
                          key={r.id}
                          onClick={() => setSelectedRun(r)}
                        >
                          <div className="execution-name">
                            <span className="execution-icon">
                              <Activity size={18} />
                            </span>
                            <div>
                              <b>{r.workflowName}</b>
                              <small>
                                {r.id.slice(0, 8)} ·{' '}
                                {r.dryRun ? 'Preview' : 'Live'} · {r.source}
                              </small>
                            </div>
                          </div>
                          <Status status={r.status} />
                          <span>
                            {
                              r.steps.filter((s) => s.status === 'success')
                                .length
                            }{' '}
                            completed
                          </span>
                          <span>
                            {relative(r.createdAt)} <ChevronRight size={15} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state large">
                      <Activity size={32} />
                      <h3>
                        {runs.length
                          ? 'No matching executions.'
                          : 'A clear view of every run.'}
                      </h3>
                      <p>
                        {runs.length
                          ? 'Choose another filter or search term.'
                          : 'Open a workflow and select Test flow to see your first execution.'}
                      </p>
                      <button
                        className="button primary"
                        onClick={() => navigate('workflows')}
                      >
                        Go to workflows <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  <p className="footnote">
                    Showing up to 100 recent executions. Preview runs never send
                    external messages.
                  </p>
                </>
              )}
              {view === 'integrations' && (
                <>
                  <PageHeading
                    eyebrow="YOUR TOOLS, WORKING TOGETHER"
                    title="Better, connected."
                    description="Connect once. Use your tools across every workflow in this workspace."
                  />
                  <div className="integration-grid">
                    {(['webhook', 'slack', 'email'] as const).map((kind) => (
                      <article className="integration-card" key={kind}>
                        <div className="integration-top">
                          <span
                            className="node-icon"
                            style={{ background: pluginInfo[kind].color }}
                          >
                            <NodeIcon kind={kind} size={25} />
                          </span>
                          <Status
                            status={
                              kind === 'webhook'
                                ? 'ready'
                                : connected(kind)
                                  ? 'connected'
                                  : 'not connected'
                            }
                          />
                        </div>
                        <h3>
                          {kind === 'email'
                            ? 'Email by Resend'
                            : pluginInfo[kind].name}
                        </h3>
                        <p>{pluginInfo[kind].description}</p>
                        <small>
                          {kind === 'webhook'
                            ? 'Signed GitHub events & custom webhooks'
                            : kind === 'slack'
                              ? 'Incoming webhook · One channel'
                              : 'API key · Verified sending domain'}
                        </small>
                        {kind === 'webhook' ? (
                          <button
                            className="button"
                            onClick={() => navigate('workflows')}
                          >
                            Open a workflow <ArrowUpRight size={15} />
                          </button>
                        ) : (
                          <button
                            className="button"
                            onClick={() => {
                              setConnection(kind);
                              setCredentials({ url: '', apiKey: '', from: '' });
                            }}
                          >
                            {connected(kind)
                              ? 'Manage connection'
                              : 'Connect ' +
                                (kind === 'email' ? 'Resend' : 'Slack')}
                            <ArrowRight size={15} />
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                  <div className="security-note">
                    <Lock size={20} />
                    <div>
                      <h3>Your credentials stay yours.</h3>
                      <p>
                        Encrypted with AES-256-GCM on the server. Never included
                        in exported workflows or returned to your browser.
                      </p>
                    </div>
                  </div>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">
                        BUILT IN, NO CONNECTION NEEDED
                      </div>
                      <h2>Give your data a little direction.</h2>
                    </div>
                  </div>
                  <div className="integration-grid">
                    {(['transform', 'filter', 'log'] as const).map((kind) => (
                      <article className="utility-card" key={kind}>
                        <span
                          className="node-icon"
                          style={{ background: pluginInfo[kind].color }}
                        >
                          <NodeIcon kind={kind} />
                        </span>
                        <div>
                          <h3>{pluginInfo[kind].name}</h3>
                          <p>{pluginInfo[kind].description}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {view === 'docs' && (
                <Documentation onCreate={() => setCreateOpen(true)} />
              )}
              {view === 'settings' && (
                <>
                  <PageHeading
                    eyebrow="MAKE YOURSELF AT HOME"
                    title="Your space. Your rules."
                    description="Manage workspace details, recovery, and your data."
                  />
                  <section className="settings-card">
                    <h3>
                      {workspace.account
                        ? 'Connected to Google'
                        : 'Sign in from anywhere.'}
                    </h3>
                    <p>
                      {workspace.account
                        ? workspace.account.email
                        : 'Connect your Google account to this workspace. Your existing workflows and integrations stay right here.'}
                    </p>
                    {!workspace.account && authConfig.google && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await signInWithGoogle(true);
                          } catch (e) {
                            toast.error((e as Error).message);
                            setBusy(false);
                          }
                        }}
                      >
                        <GoogleMark /> Connect Google account
                      </button>
                    )}
                    <small>
                      {authConfig.database === 'supabase-postgres'
                        ? 'Workspace data is stored in PostgreSQL.'
                        : 'Your workspace is saved on this server.'}
                    </small>
                  </section>
                  <section className="settings-card">
                    <h3>Workspace details</h3>
                    <p>A name that feels like you.</p>
                    <Field label="Workspace name">
                      <input
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        maxLength={60}
                      />
                    </Field>
                    <button
                      className="button primary"
                      disabled={busy || !workspaceName.trim()}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api('workspace', {
                            method: 'PATCH',
                            body: JSON.stringify({ name: workspaceName }),
                          });
                          setWorkspace((w) =>
                            w ? { ...w, name: workspaceName } : null,
                          );
                          toast.success('Workspace updated');
                        } catch (e) {
                          toast.error((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Save changes
                    </button>
                  </section>
                  <section className="settings-card">
                    <h3>Keep the key to your workspace.</h3>
                    <p>
                      Your private recovery key opens this workspace on another
                      device. Anyone with the key can access your workflows and
                      use connected integrations.
                    </p>
                    <div className="settings-actions">
                      <button
                        className="button"
                        onClick={async () => {
                          if (recovery) {
                            setRecoveryOpen(true);
                            return;
                          }
                          setBusy(true);
                          try {
                            const data = await api('recovery', post({}));
                            setRecovery(data.recoveryKey);
                            setRecoveryOpen(true);
                          } catch (e) {
                            toast.error((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                      >
                        <KeyRound size={16} />
                        {recovery
                          ? 'View recovery key'
                          : 'Generate new recovery key'}
                      </button>
                      <button
                        className="button"
                        onClick={() => setRestoreOpen(true)}
                      >
                        Restore another workspace
                      </button>
                    </div>
                    <small>
                      Generating a new key invalidates the previous recovery
                      key. Existing browser sessions stay signed in.
                    </small>
                  </section>
                  <section className="settings-card">
                    <h3>Take your work with you.</h3>
                    <p>
                      Exported workflows contain your logic and settings,
                      without integration credentials or webhook secrets.
                    </p>
                    <div className="settings-actions">
                      <button
                        className="button"
                        onClick={() =>
                          workflows.forEach((w) =>
                            download(`${w.name}.json`, {
                              name: w.name,
                              description: w.description,
                              active: false,
                              nodes: w.nodes,
                              edges: w.edges,
                            }),
                          )
                        }
                        disabled={!workflows.length}
                      >
                        <Download size={16} /> Export workflows
                      </button>
                      <button
                        className="button"
                        onClick={() => uploadRef.current?.click()}
                      >
                        <Upload size={16} /> Import workflow
                      </button>
                      <button
                        className="button"
                        onClick={async () => {
                          await api('session', { method: 'DELETE' });
                          setDisconnected(true);
                          setRecovery('');
                          setRecoveryOpen(false);
                          setWorkspace(null);
                          setWorkflows([]);
                          setRuns([]);
                          setIntegrations([]);
                          boot = null;
                          toast.success(
                            'Signed out. Sign in again to return to your workspace.',
                          );
                        }}
                      >
                        <LogOut size={16} /> Sign out
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            Made for builders. Open to everyone.
            <span>
              <i className="online-dot" /> Flowline v1.0
            </span>
          </footer>
        </div>
      </main>
      <input
        ref={uploadRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFlow(f);
          e.target.value = '';
        }}
      />
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Give your next idea a name."
        description="Start with a webhook, a transform, and an output. Make it yours."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(0, createName);
          }}
        >
          <Field label="Workflow name">
            <input
              autoFocus
              required
              maxLength={100}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. New lead → welcome email"
            />
          </Field>
          <div className="modal-actions">
            <button
              className="button"
              type="button"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={creating || !createName.trim()}
            >
              {creating ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              Create workflow
            </button>
          </div>
        </form>
      </Modal>
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(v) => {
          if (!v) setDeleteId(null);
        }}
      >
        <AlertDialogContent className="flow-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              The webhook will stop accepting events. Past execution history
              will remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep workflow</AlertDialogCancel>
            <AlertDialogAction
              className="danger-button"
              onClick={async () => {
                try {
                  await api(`workflows/${deleteId}`, { method: 'DELETE' });
                  setWorkflows((w) => w.filter((w) => w.id !== deleteId));
                  setDeleteId(null);
                  toast.success('Workflow deleted');
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Delete workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {runModal}
      <Modal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title="This workspace is yours."
        description="Save your private recovery key somewhere safe. It’s the way back to your work on another device."
      >
        <div className="key-card">
          <KeyRound size={24} />
          <code>{recovery}</code>
        </div>
        <button
          className="button primary full"
          onClick={() => void copy(recovery)}
        >
          <Copy size={16} /> Copy recovery key
        </button>
        <p className="hint">
          Your work is saved on the server. Keep this key private; it grants
          access to the entire workspace.
        </p>
        <button
          className="text-button centered"
          onClick={() => setRecoveryOpen(false)}
        >
          I’ve saved my key <ArrowRight size={14} />
        </button>
      </Modal>
      <Modal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="Welcome back."
        description="Paste the recovery key for the workspace you want to open."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const data = await api(
                'session',
                post({ recoveryKey: restoreKey.trim() }),
              );
              setRecovery(data.recoveryKey || '');
              setWorkspace(data.workspace);
              setWorkspaceName(data.workspace.name);
              setDisconnected(false);
              setRecovery(restoreKey.trim());
              setRestoreOpen(false);
              await refresh();
              toast.success('Workspace restored');
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Recovery key">
            <input
              type="password"
              required
              value={restoreKey}
              onChange={(e) => setRestoreKey(e.target.value)}
              placeholder="flw_…"
              autoComplete="off"
            />
          </Field>
          <button className="button primary full" disabled={busy}>
            Restore workspace <ArrowRight size={16} />
          </button>
        </form>
      </Modal>
      <Modal
        open={!!connection}
        onClose={() => setConnection(null)}
        title={
          connection === 'slack'
            ? 'Connect your Slack channel'
            : 'Connect Resend'
        }
        description={
          connection === 'slack'
            ? 'Create an incoming webhook in your Slack app and paste its URL.'
            : 'Use a Resend API key and a verified sender address.'
        }
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(`integrations/${connection}`, {
                method: 'PUT',
                body: JSON.stringify(
                  connection === 'slack'
                    ? { url: credentials.url }
                    : { apiKey: credentials.apiKey, from: credentials.from },
                ),
              });
              await refresh();
              setConnection(null);
              toast.success(
                'Connection saved securely. Run a workflow to verify delivery.',
              );
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {connection === 'slack' ? (
            <Field label="Incoming webhook URL">
              <input
                type="password"
                required
                placeholder="https://hooks.slack.com/services/…"
                autoComplete="off"
                value={credentials.url}
                onChange={(e) =>
                  setCredentials((c) => ({ ...c, url: e.target.value }))
                }
              />
            </Field>
          ) : (
            <>
              <Field label="Resend API key">
                <input
                  type="password"
                  required
                  placeholder="re_…"
                  autoComplete="off"
                  value={credentials.apiKey}
                  onChange={(e) =>
                    setCredentials((c) => ({ ...c, apiKey: e.target.value }))
                  }
                />
              </Field>
              <Field
                label="From address"
                hint="Must match a verified domain in Resend."
              >
                <input
                  required
                  placeholder="Your team <hello@yourdomain.com>"
                  value={credentials.from}
                  onChange={(e) =>
                    setCredentials((c) => ({ ...c, from: e.target.value }))
                  }
                />
              </Field>
            </>
          )}
          <a
            className="provider-docs"
            href={
              connection === 'slack'
                ? 'https://api.slack.com/messaging/webhooks'
                : 'https://resend.com/docs/dashboard/api-keys/introduction'
            }
            target="_blank"
            rel="noreferrer"
          >
            Open {connection === 'slack' ? 'Slack' : 'Resend'} setup guide{' '}
            <ExternalLink size={13} />
          </a>
          <div className="modal-actions">
            {connection && connected(connection) && (
              <button
                type="button"
                className="danger-text"
                onClick={async () => {
                  try {
                    await api(`integrations/${connection}`, {
                      method: 'DELETE',
                    });
                    await refresh();
                    setConnection(null);
                    toast.success('Integration disconnected');
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Disconnect
              </button>
            )}
            <button className="button primary" disabled={busy}>
              <Lock size={14} />
              Save connection
            </button>
          </div>
        </form>
      </Modal>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading interior-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function TemplateGrid({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (index: number) => void;
}) {
  return (
    <div className="template-grid">
      {templates.map((t, i) => (
        <button
          className="template-card"
          disabled={disabled}
          onClick={() => onCreate(i)}
          key={t.title}
        >
          <div className="template-icons">
            <span>
              <Webhook />
            </span>
            <ArrowRight size={14} />
            <span>
              <NodeIcon kind={t.kind} />
            </span>
            <ArrowUpRight className="template-arrow" />
          </div>
          <h3>{t.title}</h3>
          <p>{t.description}</p>
          <small>{t.steps}</small>
        </button>
      ))}
    </div>
  );
}
function Documentation({ onCreate }: { onCreate: () => void }) {
  return (
    <>
      <PageHeading
        eyebrow="BUILD SOMETHING THAT WORKS FOR YOU"
        title="A little guidance. A lot of possibility."
        description="From your first event to your own custom plugin."
      />
      <div className="docs-layout">
        <div>
          <section className="docs-section" id="quickstart">
            <span className="docs-number">01 / QUICKSTART</span>
            <h2>Your first flow in a few minutes.</h2>
            <ol>
              <li>
                <b>Create a workflow.</b> Start from “Capture a webhook.” The
                canvas comes with three connected nodes.
              </li>
              <li>
                <b>Make it yours.</b> Click a node to edit its settings. Drag
                nodes to arrange them, or connect handles to change the path.
              </li>
              <li>
                <b>Test it.</b> Select Test flow, edit the JSON input, and run a
                preview. Inspect the output of every step.
              </li>
              <li>
                <b>Go live.</b> Connect Slack or Resend if you need them.
                Activate the flow, then send an event to its webhook.
              </li>
            </ol>
            <button className="button primary" onClick={onCreate}>
              Build your first flow <ArrowUpRight size={16} />
            </button>
          </section>
          <section className="docs-section" id="data">
            <span className="docs-number">02 / WORKING WITH DATA</span>
            <h2>Pass the right information forward.</h2>
            <p>
              Use dynamic values in any message or transform. No scripts or eval
              required.
            </p>
            <div className="docs-table">
              <div>
                <code>{'{{trigger.email}}'}</code>
                <span>A value from the original event</span>
              </div>
              <div>
                <code>{'{{input.message}}'}</code>
                <span>A value from the previous step</span>
              </div>
              <div>
                <code>{'{{steps.transform_id.name}}'}</code>
                <span>A value from a particular step</span>
              </div>
            </div>
            <pre>
              {
                '{\n  "customer": "{{trigger.name}}",\n  "email": "{{trigger.email}}",\n  "source": "Flowline"\n}'
              }
            </pre>
            <p>
              A transform expects valid JSON. A full-value expression preserves
              its data type. Missing values become null; missing values inside
              text become empty strings.
            </p>
          </section>
          <section className="docs-section" id="engine">
            <span className="docs-number">03 / EXECUTION & RETRIES</span>
            <h2>Know what happened. And why.</h2>
            <p>
              Every workflow is a directed acyclic graph with one webhook
              trigger. Nodes run in dependency order. A false condition skips
              its descendants; other connected branches continue.
            </p>
            <p>
              Transient provider failures (network errors, HTTP 429, and 5xx)
              retry up to three attempts with exponential backoff. Configuration
              and authentication errors fail immediately. Inspect each attempt
              count in Executions.
            </p>
            <p>
              Delivery is at least once. A provider may accept a message before
              a network timeout, so retrying can produce duplicates. Design
              important downstream actions to be idempotent.
            </p>
          </section>
          <section className="docs-section" id="selfhost">
            <span className="docs-number">04 / SELF-HOSTING</span>
            <h2>Your infrastructure. Your automation.</h2>
            <p>
              Run the same engine on your machine with Postgres, Redis, and a
              durable BullMQ worker.
            </p>
            <pre>
              {
                'git clone https://github.com/YashAnand69/flowline.git\ncd flowline\ndocker compose up --build'
              }
            </pre>
            <p>
              Open <code>http://localhost:3001</code>. Persistent Docker volumes
              retain workflows, execution history, and the generated encryption
              key. Set APP_ORIGIN and put an HTTPS proxy in front before
              exposing it publicly.
            </p>
            <a
              className="button"
              href={`${repo}#self-hosting`}
              target="_blank"
              rel="noreferrer"
            >
              Installation guide <ArrowUpRight size={15} />
            </a>
          </section>
          <section className="docs-section" id="plugins">
            <span className="docs-number">05 / EXTENDING FLOWLINE</span>
            <h2>Bring your own possibilities.</h2>
            <p>
              Plugins implement a shared validate/execute contract. Register a
              new action, define its configuration, and run the shared contract
              tests. Webhook triggers expose a subscribe contract for endpoint
              discovery.
            </p>
            <a
              className="button"
              href={`${repo}/blob/main/docs/PLUGINS.md`}
              target="_blank"
              rel="noreferrer"
            >
              Plugin authoring guide <ArrowUpRight size={15} />
            </a>
          </section>
        </div>
        <aside className="docs-toc">
          <span>ON THIS PAGE</span>
          {[
            ['quickstart', 'Your first workflow'],
            ['data', 'Working with data'],
            ['engine', 'Execution & retries'],
            ['selfhost', 'Self-hosting'],
            ['plugins', 'Custom plugins'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
              <ArrowUpRight size={13} />
            </a>
          ))}
          <div className="docs-note">
            <Lock size={18} />
            <p>
              Your workspace supports 30 workflows, 30 nodes per flow, 200 runs
              per day, and five concurrent runs.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
