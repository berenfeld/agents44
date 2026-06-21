import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pending: "border-slate-200 bg-slate-100 text-slate-700",
  running: "border-blue-200 bg-blue-50 text-blue-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-800",
};

export function RunStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const style = STATUS_STYLES[normalized] ?? "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        style,
      )}
    >
      {normalized === "running" ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
        </span>
      ) : null}
      {status}
    </span>
  );
}
