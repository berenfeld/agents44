import { useEffect, useMemo, useRef } from "react";
import { highlightSearch } from "@/lib/search-highlight";

export function RunLogViewer({
  content,
  search = "",
  autoScroll = false,
}: {
  content: string;
  search?: string;
  autoScroll?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlighted = useMemo(() => highlightSearch(content, search), [content, search]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [content, autoScroll]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded border bg-white">
      <pre
        className="whitespace-pre-wrap break-words p-4 font-mono text-sm text-slate-900"
        dangerouslySetInnerHTML={{ __html: highlighted || "(empty)" }}
      />
    </div>
  );
}
