import type { ReactNode } from 'react';
import {
  Webhook,
  Mail,
  GitBranch,
  Braces,
  ScrollText,
  Hash,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Kind } from '../shared/model';
export function NodeIcon({ kind, size = 19 }: { kind: Kind; size?: number }) {
  const Icon = {
    webhook: Webhook,
    email: Mail,
    filter: GitBranch,
    transform: Braces,
    log: ScrollText,
    slack: Hash,
  }[kind];
  return <Icon size={size} />;
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className={`flow-modal ${wide ? 'wide' : ''}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description || 'Configure your workspace.'}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span className={`status-pill ${status}`}>
      <i />
      {status === 'success'
        ? 'Successful'
        : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
