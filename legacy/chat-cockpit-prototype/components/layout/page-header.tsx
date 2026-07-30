export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function ComingSoon({ phase, children }: { phase: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-10">
      <div className="mx-auto flex max-w-lg flex-col items-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{children}</p>
        <p className="mt-1 text-xs text-muted-foreground">Planned for {phase}.</p>
      </div>
    </div>
  );
}
