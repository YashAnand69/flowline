import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  ArrowUpRight,
  ArrowDown,
  ArrowRight,
  GitBranch,
  Mouse,
  Webhook,
  Braces,
  Hash,
  Check,
  Mail,
  ScrollText,
  Copy,
  CheckCheck,
} from 'lucide-react';
const Scene = lazy(() => import('./Scene'));
export default function Explore({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: () => void;
}) {
  const [progress, setProgress] = useState(0),
    [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    const onScroll = () => {
      const height = (root.current?.scrollHeight ?? 1) - innerHeight;
      setProgress(Math.min(1, Math.max(0, scrollY / height)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className="experience" ref={root}>
      <div
        className="experience-progress"
        style={{ transform: `scaleX(${progress})` }}
      />
      <header className="experience-nav">
        <button className="brand" onClick={onClose}>
          <span className="brand-icon">
            <GitBranch />
          </span>
          flowline<span className="brand-dot">®</span>
        </button>
        <div>
          <a
            href="https://github.com/YashAnand69/flowline"
            target="_blank"
            rel="noreferrer"
          >
            Open source <ArrowUpRight size={14} />
          </a>
          <button onClick={onClose}>
            Open workspace <ArrowUpRight size={16} />
          </button>
        </div>
      </header>
      <div className="experience-scene">
        <Suspense
          fallback={
            <div className="scene-fallback">
              <span>∞</span>
            </div>
          }
        >
          <Scene progress={progress} />
        </Suspense>
        <div className="scene-glow" />
      </div>
      <section className="experience-hero">
        <div className="experience-eyebrow">
          <span /> THE OPEN-SOURCE AUTOMATION ENGINE
        </div>
        <h1>
          Less busywork.
          <br />
          <span>More possibility.</span>
        </h1>
        <div className="hero-bottom">
          <p>
            Your ideas deserve momentum.
            <br />
            Connect your tools. Let the rest flow.
          </p>
          <button
            className="round-cta"
            onClick={onCreate}
            aria-label="Create a workflow"
          >
            <ArrowUpRight size={32} />
          </button>
        </div>
        <div className="scroll-prompt">
          <ArrowDown size={15} />
          <span>SCROLL TO CONNECT THE DOTS</span>
          <span className="hero-coord">01 — FLOW STATE</span>
        </div>
      </section>
      <section className="experience-chapter chapter-one">
        <span className="chapter-number">01 / CONNECT</span>
        <h2>
          Great things start
          <br />
          with a <em>connection.</em>
        </h2>
        <p>
          A new issue. A new lead. A spark of an idea.
          <br />
          Give it somewhere to go.
        </p>
        <div className="glass-flow">
          <div>
            <Webhook />
            <span>Something happens</span>
            <small>WEBHOOK TRIGGER</small>
          </div>
          <span className="flow-connector">→</span>
          <div>
            <Braces />
            <span>Make it meaningful</span>
            <small>TRANSFORM DATA</small>
          </div>
          <span className="flow-connector">→</span>
          <div>
            <Hash />
            <span>Keep everyone in sync</span>
            <small>SLACK ACTION</small>
          </div>
        </div>
      </section>
      <section className="experience-chapter chapter-two">
        <div className="chapter-copy">
          <span className="chapter-number">02 / ORCHESTRATE</span>
          <h2>
            A little logic.
            <br />
            <em>A lot of freedom.</em>
          </h2>
          <p>
            Shape your data. Set your conditions.
            <br />
            Build a workflow that thinks the way you do.
          </p>
          <button className="experience-link" onClick={onCreate}>
            Find your flow <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="experience-code">
          <div className="code-title">
            <span />
            <span />
            <span />
            <b>welcome-flow.json</b>
          </div>
          <pre>
            <span className="code-muted">
              {'// YOUR DATA. YOUR DIRECTION.\n\n'}
            </span>
            {'{\n'}
            {'  '}
            <span className="code-lime">"when"</span>
            {': "a new lead arrives",\n'}
            {'  '}
            <span className="code-lime">"if"</span>
            {': "they want to hear from you",\n'}
            {'  '}
            <span className="code-lime">"then"</span>
            {
              ': [\n    "send a warm welcome",\n    "let your team know"\n  ]\n}'
            }
          </pre>
          <small>AN IDEA IN PLAIN WORDS. A FLOW ON YOUR CANVAS.</small>
        </div>
      </section>
      <section className="experience-chapter chapter-three">
        <span className="chapter-number">03 / UNDERSTAND</span>
        <h2>
          Nothing hidden.
          <br />
          <em>Everything in view.</em>
        </h2>
        <p>
          Every step. Every retry. Every result.
          <br />
          Automation you can actually understand.
        </p>
        <div className="experience-run">
          <div className="experience-run-head">
            <span className="pulse-dot" /> EXECUTION COMPLETE <span>3 / 3</span>
          </div>
          {[
            ['Event received', 'Webhook'],
            ['Data transformed', 'Transform'],
            ['Result captured', 'Output'],
          ].map(([name, type], i) => (
            <div className="experience-run-step" key={name}>
              <span>0{i + 1}</span>
              <Check size={16} />
              <b>{name}</b>
              <small>{type}</small>
            </div>
          ))}
          <span className="illustration-label">
            ILLUSTRATIVE RUN · TRY YOUR OWN IN THE WORKSPACE
          </span>
        </div>
      </section>
      <section className="experience-final">
        <span className="chapter-number">
          BUILT FOR BUILDERS. OPEN TO EVERYONE.
        </span>
        <h2>
          Make room
          <br />
          for <em>what’s next.</em>
        </h2>
        <p>Your infrastructure. Your integrations. Your possibilities.</p>
        <button className="experience-primary" onClick={onCreate}>
          Build your first workflow <ArrowUpRight size={23} />
        </button>
        <button
          className="install-command"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                'git clone https://github.com/YashAnand69/flowline.git && cd flowline && docker compose up --build',
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              setCopied(false);
            }
          }}
        >
          <code>docker compose up --build</code>
          {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
        </button>
        <span className="install-hint">
          Self-host after cloning the repository. MIT licensed.
        </span>
        <footer>
          <span>flowline / WORK IN MOTION</span>
          <a
            href="https://github.com/YashAnand69/flowline"
            target="_blank"
            rel="noreferrer"
          >
            View the source <ArrowUpRight size={14} />
          </a>
          <button onClick={onClose}>
            Back to workspace <ArrowRight size={14} />
          </button>
        </footer>
      </section>
    </div>
  );
}
