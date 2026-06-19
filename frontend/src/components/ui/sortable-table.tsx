import { cn } from "@/lib/utils";
import type { SortDirection } from "@/hooks/useTableSort";

export function SortableTh({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  direction: SortDirection;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={cn("px-4 py-2", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900",
          active && "text-slate-900",
        )}
      >
        {label}
        <span className="text-xs text-slate-400" aria-hidden>
          {active ? (direction === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
