import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightSearch } from "@/lib/search-highlight";

const markdownClassName =
  "text-sm leading-relaxed text-slate-900 [&_*]:text-slate-900 [&_a]:underline [&_code]:rounded [&_code]:border [&_code]:border-slate-200 [&_code]:bg-slate-50 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-50 [&_pre]:p-3 [&_pre]:text-slate-900 [&_table]:mb-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5";

export function RunSummaryViewer({
  content,
  search = "",
}: {
  content: string;
  search?: string;
}) {
  const trimmed = content.trim();
  const searching = search.trim().length > 0;
  const highlighted = useMemo(() => highlightSearch(content, search), [content, search]);

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded border bg-white p-4">
      {!trimmed ? (
        <p className="text-sm text-slate-500">(empty)</p>
      ) : searching ? (
        <pre
          className="whitespace-pre-wrap break-words font-mono text-sm text-slate-900"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <div className={markdownClassName}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
