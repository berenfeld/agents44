import { Input } from "@/components/ui/primitives";

export type RunLogSectionFilterOption = {
  value: string;
  label: string;
};

export function RunSearchToolbar({
  search,
  onSearchChange,
  placeholder,
  matchCount,
  live,
  liveLabel = "Live",
  autoScroll,
  onAutoScrollChange,
  sectionFilter,
  sectionFilterOptions,
  onSectionFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  matchCount: number;
  live?: boolean;
  liveLabel?: string;
  autoScroll?: boolean;
  onAutoScrollChange?: (enabled: boolean) => void;
  sectionFilter?: string;
  sectionFilterOptions?: RunLogSectionFilterOption[];
  onSectionFilterChange?: (value: string) => void;
}) {
  const showSectionFilter =
    sectionFilter != null &&
    sectionFilterOptions != null &&
    sectionFilterOptions.length > 1 &&
    onSectionFilterChange != null;

  return (
    <>
      {showSectionFilter ? (
        <select
          aria-label="Filter log sections"
          className="h-8 max-w-[14rem] shrink-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
          value={sectionFilter}
          onChange={(event) => onSectionFilterChange(event.target.value)}
        >
          {sectionFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
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
