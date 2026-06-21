import { Input } from "@/components/ui/primitives";

export function RunSearchToolbar({
  search,
  onSearchChange,
  placeholder,
  matchCount,
  live,
  liveLabel = "Live",
  autoScroll,
  onAutoScrollChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  matchCount: number;
  live?: boolean;
  liveLabel?: string;
  autoScroll?: boolean;
  onAutoScrollChange?: (enabled: boolean) => void;
}) {
  return (
    <>
      <Input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 min-w-0 flex-1 px-2 text-sm"
        aria-label={placeholder}
      />
      {search.trim() ? (
        <span className="shrink-0 text-xs text-slate-500">
          {matchCount} match{matchCount === 1 ? "" : "es"}
        </span>
      ) : null}
      {live && autoScroll != null && onAutoScrollChange ? (
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => onAutoScrollChange(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Auto-scroll
        </label>
      ) : null}
      {live ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
          </span>
          {liveLabel}
        </span>
      ) : null}
    </>
  );
}
