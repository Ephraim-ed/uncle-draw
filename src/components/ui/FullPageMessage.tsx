import type { ReactNode } from "react";

export interface FullPageMessageProps {
  doodle?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}

/** Dot-grid page with a doodle, a display headline and actions (404, errors, erased links). */
export function FullPageMessage({ doodle, title, children, actions }: FullPageMessageProps) {
  return (
    <main className="ud-shell ud-dot-grid flex min-h-dvh items-center justify-center px-4 py-12 tablet:px-6">
      <div className="flex max-w-xl flex-col items-center gap-6 text-center">
        {doodle ? <div className="text-ink">{doodle}</div> : null}
        <h1 className="font-hand text-display text-ink">{title}</h1>
        {children ? <div className="text-body text-ink-muted">{children}</div> : null}
        {actions ? <div className="flex flex-wrap items-center justify-center gap-4">{actions}</div> : null}
      </div>
    </main>
  );
}
