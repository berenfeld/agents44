import ReactMarkdown from "react-markdown";

const markdownClassName =
  "text-sm leading-relaxed text-slate-900 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5";

export function RunSummaryViewer({ content, live }: { content: string; live?: boolean }) {
  const trimmed = content.trim();

  return (
    <div className="space-y-3">
      {live ? (
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            Waiting for summary
          </span>
        </div>
      ) : null}
      <div className="max-h-[75vh] overflow-y-auto rounded border bg-white p-4">
        {trimmed ? (
          <div className={markdownClassName}>
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-slate-500">(empty)</p>
        )}
      </div>
    </div>
  );
}
