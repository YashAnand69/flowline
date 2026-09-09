import { useState } from 'react';
import {
  ArrowRight,
  GitBranch,
  KeyRound,
  Loader2,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { api, post } from './client';
export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.59C7.18 7.72 9.39 5.96 12 5.96Z"
      />
    </svg>
  );
}
export async function signInWithGoogle(link = false) {
  const { url } = await api('auth/google', post({ link }));
  location.assign(url);
}
export default function AuthScreen({
  google,
  loading,
  error: initialError,
  onSession,
  onExplore,
}: {
  google: boolean;
  loading: boolean;
  error: string;
  onSession: (data: any) => Promise<void>;
  onExplore: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [restore, setRestore] = useState(false),
    [key, setKey] = useState('');
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-icon">
            <GitBranch />
          </span>
          flowline<span className="brand-dot">®</span>
        </a>
        <span className="auth-eyebrow">LESS BUSYWORK. MORE POSSIBILITY.</span>
        <h1>
          Your ideas.
          <br />
          In <em>motion.</em>
        </h1>
        <p>
          Connect your tools. Shape your logic. Build workflows that make room
          for the work you love.
        </p>
        <div className="auth-flow-art" aria-hidden="true">
          <span>
            <Workflow /> Event
          </span>
          <i />
          <span>
            <GitBranch /> Logic
          </span>
          <i />
          <span>
            <ShieldCheck /> Done
          </span>
        </div>
        <button className="auth-explore" onClick={onExplore}>
          Explore the experience <ArrowRight size={18} />
        </button>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h2>Welcome to Flowline.</h2>
          <p>
            One place for your workflows, connections, and everything they make
            happen.
          </p>
          {(error || initialError) && (
            <div className="auth-error" role="alert">
              {error || initialError}
            </div>
          )}
          <button
            className="button google-button"
            disabled={busy || loading || !google}
            onClick={() => void action(() => signInWithGoogle())}
          >
            {busy || loading ? (
              <Loader2 className="spin" size={20} />
            ) : (
              <GoogleMark />
            )}{' '}
            Continue with Google <ArrowRight size={18} />
          </button>
          {!google && !loading && (
            <small>
              Google sign-in is not configured on this installation.
            </small>
          )}
          <div className="auth-divider">
            <span>already have a workspace?</span>
          </div>
          <button
            className="auth-key-button"
            onClick={() => setRestore(!restore)}
            aria-expanded={restore}
          >
            <KeyRound size={17} /> Use a recovery key
          </button>
          {restore && (
            <form
              className="auth-restore"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () =>
                  onSession(
                    await api('session', post({ recoveryKey: key.trim() })),
                  ),
                );
              }}
            >
              <label htmlFor="recovery-login">Workspace recovery key</label>
              <input
                id="recovery-login"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                required
                minLength={30}
                placeholder="flw_…"
              />
              <button className="button primary" disabled={busy}>
                Open workspace <ArrowRight size={16} />
              </button>
            </form>
          )}
          {!google && !loading && !initialError && (
            <button
              className="auth-key-button"
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  onSession(await api('session', post({}))),
                )
              }
            >
              Create a workspace <ArrowRight size={16} />
            </button>
          )}
          <div className="auth-trust">
            <ShieldCheck size={17} />
            <span>Private by default. Your integrations stay encrypted.</span>
          </div>
          <p className="auth-legal">
            Google shares your name and email for sign-in. Flowline does not
            request access to your Gmail or Drive.
            {' '}<a href="/privacy.html">Privacy notice</a>
          </p>
        </div>
      </section>
    </main>
  );
}
