import { useMemo } from "react";
import { Input } from "@/components/ui/primitives";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSearch(text: string, query: string) {
  const escaped = escapeHtml(text);
  const trimmed = query.trim();
  if (!trimmed) {
    return escaped;
  }
  return escaped.replace(new RegExp(escapeRegExp(trimmed), "gi"), (match) => {
    return `<mark class="rounded bg-yellow-200 px-0.5 text-slate-900">${match}</mark>`;
  });
}

function countMatches(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return 0;
  }
  const matches = text.match(new RegExp(escapeRegExp(trimmed), "gi"));
  return matches?.length ?? 0;
}

export function RunLogViewer({
  content,
  search,
  onSearchChange,
  live,
}: {
  content: string;
  search: string;
  onSearchChange: (value: string) => void;
  live?: boolean;
}) {
  const highlighted = useMemo(() => highlightSearch(content, search), [content, search]);
  const matches = useMemo(() => countMatches(content, search), [content, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search log…"
          className="max-w-md"
        />
        {search.trim() ? (
          <span className="text-sm text-slate-500">
            {matches} match{matches === 1 ? "" : "es"}
          </span>
        ) : null}
        {live ? (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            Live
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded border bg-white">
        <pre
          className="whitespace-pre-wrap break-words p-4 font-mono text-sm text-slate-900"
          dangerouslySetInnerHTML={{ __html: highlighted || "(empty)" }}
        />
      </div>
    </div>
  );
}
