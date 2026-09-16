import { useEffect, useMemo, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/primitives";
import {
  extension,
  fileName,
  fileRawUrl,
  formatFileSize,
  formatModified,
  isEditable,
  isPdfFile,
  isTextOrMarkdownFile,
  type TextDirection,
} from "@/lib/workspace-files";
import { cn } from "@/lib/utils";

const editorAutoHeight = EditorView.theme({
  "&": { height: "auto !important", width: "100%" },
  ".cm-scroller": { overflow: "auto !important", height: "auto !important" },
});

const editorFillHeight = EditorView.theme({
  "&": { height: "100%", width: "100%" },
  ".cm-scroller": { overflow: "auto", height: "100%" },
});

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("h-4 w-4", className)} aria-hidden="true">
      <path d="M12 3v12M8 11l4 4 4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TextDirectionToggle({
  value,
  onChange,
}: {
  value: TextDirection;
  onChange: (direction: TextDirection) => void;
}) {
  const options: { direction: TextDirection; label: string; title: string }[] = [
    { direction: "ltr", label: "LTR", title: "Left to right" },
    { direction: "rtl", label: "RTL", title: "Right to left" },
  ];
  return (
    <div className="inline-flex h-8 overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Text direction">
      {options.map((option) => {
        const active = value === option.direction;
        return (
          <button
            key={option.direction}
            type="button"
            title={option.title}
            aria-label={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.direction)}
            className={cn(
              "h-full min-w-8 px-2 text-xs font-medium",
              active ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function FileEditorPane({
  path,
  content,
  sizeBytes,
  modifiedAt,
  dirty,
  saveStatus,
  viewMode,
  textDirection,
  onContentChange,
  onViewModeChange,
  onTextDirectionChange,
  onSave,
  toolbarStart,
  toolbarExtra,
  fillHeight,
  className,
}: {
  path: string;
  content: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  dirty: boolean;
  saveStatus: "idle" | "saving" | "saved";
  viewMode: boolean;
  textDirection: TextDirection;
  onContentChange: (value: string) => void;
  onViewModeChange: (viewMode: boolean) => void;
  onTextDirectionChange: (direction: TextDirection) => void;
  onSave: () => void;
  toolbarStart?: ReactNode;
  toolbarExtra?: ReactNode;
  fillHeight?: boolean;
  className?: string;
}) {
  const pdf = isPdfFile(path);
  const editable = isEditable(path);
  const textOrMarkdown = isTextOrMarkdownFile(path);
  const contentDir = textOrMarkdown ? textDirection : "ltr";

  const editorExtensions = useMemo(() => {
    const ext = extension(path);
    const lang = ext === "json" ? [json()] : ext === "md" || ext === "markdown" ? [markdown()] : [];
    const direction = isTextOrMarkdownFile(path) ? textDirection : "ltr";
    return [
      EditorView.lineWrapping,
      fillHeight ? editorFillHeight : editorAutoHeight,
      EditorView.contentAttributes.of({ dir: direction }),
      ...lang,
    ];
  }, [path, textDirection, fillHeight]);

  useEffect(() => {
    if (viewMode || !editable) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (dirty && saveStatus !== "saving") {
          onSave();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewMode, editable, dirty, saveStatus, onSave]);

  const renderFileContent = () => {
    if (pdf) {
      return (
        <iframe
          key={path}
          title={fileName(path)}
          src={fileRawUrl(path)}
          className={cn("w-full border-0 bg-slate-100", fillHeight ? "h-full min-h-0" : "h-full min-h-[480px]")}
        />
      );
    }

    const ext = extension(path);

    if (viewMode) {
      if (ext === "md" || ext === "markdown") {
        return (
          <div
            dir={contentDir}
            className="overflow-x-auto text-sm leading-relaxed text-slate-900 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100 [&_table]:mb-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ps-5"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        );
      }

      return (
        <pre dir={contentDir} className="whitespace-pre-wrap break-words font-mono text-sm text-slate-900">
          {content}
        </pre>
      );
    }

    if (!editable) {
      return <p className="rounded bg-amber-50 p-3 text-sm">This file type is read-only in the editor.</p>;
    }

    return (
      <div
        dir={contentDir}
        className={cn(
          "min-w-0 max-w-full overflow-hidden rounded border",
          fillHeight && "h-full min-h-0 [&_.cm-theme]:h-full [&_.cm-editor]:h-full",
        )}
      >
        <CodeMirror
          value={content}
          height={fillHeight ? "100%" : undefined}
          theme={vscodeDark}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
          extensions={editorExtensions}
          onChange={(value) => onContentChange(value)}
        />
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-white",
        fillHeight && "h-full min-h-0",
        pdf && !fillHeight && "md:h-[calc(100vh-11rem)]",
        className,
      )}
    >
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b px-2 py-1.5">
        {toolbarStart}
        <span className="shrink-0 text-sm font-semibold text-slate-800">{fileName(path)}</span>
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">|</span>
        <span className="shrink-0 text-xs text-slate-500">{formatFileSize(sizeBytes)}</span>
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">|</span>
        <span className="shrink-0 text-xs text-slate-500" title={modifiedAt ?? undefined}>
          {formatModified(modifiedAt)}
        </span>
        {dirty ? (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            Unsaved
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {textOrMarkdown ? <TextDirectionToggle value={textDirection} onChange={onTextDirectionChange} /> : null}
          {pdf ? (
            <a
              href={fileRawUrl(path, true)}
              download={fileName(path)}
              title="Download PDF"
              aria-label="Download PDF"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              <DownloadIcon />
            </a>
          ) : null}
          {viewMode ? (
            editable ? (
              <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onViewModeChange(false)}>
                Edit
              </Button>
            ) : null
          ) : (
            <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onViewModeChange(true)}>
              View
            </Button>
          )}
          {!viewMode ? (
            <Button
              className="h-8 px-2.5 text-xs"
              disabled={saveStatus === "saving" || saveStatus === "saved" || !dirty || !editable}
              onClick={onSave}
            >
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
            </Button>
          ) : null}
          {toolbarExtra}
        </div>
      </div>

      <div
        className={cn(
          "min-w-0",
          pdf ? "min-h-0 flex-1 p-0" : "p-4",
          fillHeight && !pdf && (viewMode ? "min-h-0 flex-1 overflow-auto" : "flex min-h-0 flex-1 flex-col overflow-hidden"),
        )}
      >
        {renderFileContent()}
      </div>
    </div>
  );
}
