import { cn } from "@/lib/utils";

export function MobileCardList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-3 md:hidden", className)}>{children}</div>;
}

export function DesktopTableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("hidden overflow-x-auto rounded-lg border md:block", className)}>{children}</div>
  );
}

export function DataCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border bg-white p-4 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function DataCardTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-base font-semibold text-slate-900">{children}</div>;
}

export function DataCardField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,7rem)_1fr] items-start gap-x-3 gap-y-1 border-b border-slate-100 py-2.5 last:border-0",
        className,
      )}
    >
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export function DataCardActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{children}</div>;
}
