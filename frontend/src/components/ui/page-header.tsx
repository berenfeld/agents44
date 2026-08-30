export function PageHeader({
  title,
  filters,
  actions,
}: {
  title: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {filters}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
