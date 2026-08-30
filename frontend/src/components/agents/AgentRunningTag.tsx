import { cn } from "@/lib/utils";

const STATE_STYLES = {
  running: "border-blue-200 bg-blue-50 text-blue-800",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
} as const;

export function AgentRunStateTag({
  status,
  className,
}: {
  status: "running" | "pending";
  className?: string;
}) {
  const isRunning = status === "running";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        STATE_STYLES[status],
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isRunning ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            isRunning ? "bg-blue-500" : "bg-amber-500",
          )}
        />
      </span>
      {isRunning ? "Running" : "Pending"}
    </span>
  );
}

export function AgentRunningTag({ className }: { className?: string }) {
  return <AgentRunStateTag status="running" className={className} />;
}
