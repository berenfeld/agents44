import { useEffect, useMemo, useRef } from "react";
import { formatRunLog } from "@/lib/format-run-log";
import { highlightSearch } from "@/lib/search-highlight";

function decorateFormattedLogHtml(html: string): string {
  return html
    .replace(
      /^(--- .+ ---)$/gm,
      '<span class="block mt-3 font-sans text-xs font-semibold uppercase tracking-wide text-violet-700 first:mt-0">$1</span>',
    )
    .replace(
      /^(\[(?:Session|Status)\].+)$/gm,
      '<span class="block font-sans text-xs text-slate-500">$1</span>',
    )
    .replace(/^(\$ .+)$/gm, '<span class="block text-emerald-800">$1</span>');
}

export function RunLogViewer({
  content,
  search = "",
  autoScroll = false,
  format = true,
}: {
  content: string;
  search?: string;
  autoScroll?: boolean;
  format?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayContent = useMemo(() => (format ? formatRunLog(content) : content), [content, format]);
  const highlighted = useMemo(() => {
    const base = highlightSearch(displayContent, search);
    return format ? decorateFormattedLogHtml(base) : base;
  }, [displayContent, search, format]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [displayContent, autoScroll]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded border bg-white">
      <pre
        className="whitespace-pre-wrap break-words p-4 font-mono text-sm leading-relaxed text-slate-900"
        dangerouslySetInnerHTML={{ __html: highlighted || "(empty)" }}
      />
    </div>
  );
}
