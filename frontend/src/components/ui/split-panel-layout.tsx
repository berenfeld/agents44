import { cn } from "@/lib/utils";

export function SplitPanelLayout({
  sidebar,
  children,
  className,
  sidebarClassName,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  sidebarClassName?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-4 md:flex-row md:items-start", className)}>
      <aside className={cn("w-full shrink-0 md:w-64", sidebarClassName)}>{sidebar}</aside>
      <section className="min-w-0 flex-1 space-y-3">{children}</section>
    </div>
  );
}

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border bg-white", className)}>{children}</div>;
}
