import { cn } from "@/lib/utils";

export function SplitPanelLayout({
  sidebar,
  children,
  className,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[32rem] flex-col gap-4 md:flex-row", className)}>
      <aside className="w-full shrink-0 md:w-64">{sidebar}</aside>
      <section className="min-w-0 flex-1 space-y-3">{children}</section>
    </div>
  );
}

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border bg-white", className)}>{children}</div>;
}
