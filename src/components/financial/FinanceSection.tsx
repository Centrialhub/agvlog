import { useState, type ReactNode } from 'react';

export function FinanceSection({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="group min-w-0 rounded-xl border bg-card" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
        <span className="ml-2 font-semibold">{title}</span>
        <span className="mt-1 block pl-6 text-sm font-normal text-muted-foreground">{description}</span>
      </summary>
      {open && <div className="min-w-0 space-y-5 border-t p-4 sm:p-5">{children}</div>}
    </details>
  );
}
