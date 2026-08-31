import { useEffect, useMemo, useRef, useState } from "react";
import { formatRunLog } from "@/lib/format-run-log";
import { highlightSearch } from "@/lib/search-highlight";

function markupLineRe(): RegExp {
  return /^(--- .+ ---)$/gm;
}

function formatLogClock(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function countMarkupLines(text: string): number {
  return text.match(markupLineRe())?.length ?? 0;
}

function stampMarkupLines(text: string, times: string[]): string {
  let index = 0;
  return text.replace(markupLineRe(), (header) => {
    const time = times[index++];
    return time ? `${header}  ${time}` : header;
  });
}

function decorateFormattedLogHtml(html: string): string {
  return html
    .replace(/^(--- .+? ---)(.*)$/gm, (_, header: string, suffix: string) => {
      const timeHtml = suffix.trim()
        ? `<span class="ml-2 font-mono font-normal normal-case tracking-normal text-slate-500">${suffix.trim()}</span>`
        : "";
      return `<span class="block mt-3 font-sans text-xs font-semibold uppercase tracking-wide text-violet-700 first:mt-0">${header}${timeHtml}</span>`;
    })
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
  live = false,
}: {
  content: string;
  search?: string;
  autoScroll?: boolean;
  format?: boolean;
  live?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [markupTimes, setMarkupTimes] = useState<string[]>([]);
  const displayContent = useMemo(() => (format ? formatRunLog(content) : content), [content, format]);
  const markupCount = format ? countMarkupLines(displayContent) : 0;

  let times = markupTimes;
  if (format && live && markupCount > markupTimes.length) {
    times = markupTimes.slice();
    while (times.length < markupCount) {
      times.push(formatLogClock(new Date()));
    }
    setMarkupTimes(times);
  }

  const stampedContent = format ? stampMarkupLines(displayContent, times) : displayContent;
  const highlighted = useMemo(() => {
    const base = highlightSearch(stampedContent, search);
    return format ? decorateFormattedLogHtml(base) : base;
  }, [stampedContent, search, format]);

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
