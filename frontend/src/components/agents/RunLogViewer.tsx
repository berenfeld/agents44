import { useMemo } from "react";
import { highlightSearch } from "@/lib/search-highlight";

export function RunLogViewer({
  content,
  search = "",
}: {
  content: string;
  search?: string;
}) {
  const highlighted = useMemo(() => highlightSearch(content, search), [content, search]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded border bg-white">
      <pre
        className="whitespace-pre-wrap break-words p-4 font-mono text-sm text-slate-900"
        dangerouslySetInnerHTML={{ __html: highlighted || "(empty)" }}
      />
    </div>
  );
}
