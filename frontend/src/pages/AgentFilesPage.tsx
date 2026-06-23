import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/api/client";
import { Button, Input } from "@/components/ui/primitives";
import { ConfirmModal } from "@/components/ui/modal";
import { PanelCard, SplitPanelLayout } from "@/components/ui/split-panel-layout";
import { cn } from "@/lib/utils";

type FileEntry = {
  path: string;
  name: string;
  is_dir: boolean;
  size_bytes: number | null;
  modified_at: string | null;
};
type PathResponse = {
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
  content?: string;
  size_bytes?: number | null;
  modified_at?: string | null;
};

const FILES_ROUTE_PREFIX = "/agents_files";

const editorAutoHeight = EditorView.theme({
  "&": { height: "auto !important", width: "100%" },
  ".cm-scroller": { overflow: "auto !important", height: "auto !important" },
});

function parseFilesUrl(pathname: string): string {
  if (!pathname.startsWith(FILES_ROUTE_PREFIX)) return "";
  const rest = pathname.slice(FILES_ROUTE_PREFIX.length).replace(/^\//, "");
  if (!rest) return "";
  return rest.split("/").map(decodeURIComponent).join("/");
}

function filesUrl(path = ""): string {
  if (!path) return FILES_ROUTE_PREFIX;
  return `${FILES_ROUTE_PREFIX}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function filesQueryString(
  search: string,
  options?: { edit?: boolean; sidebarCollapsed?: boolean },
): string {
  const params = new URLSearchParams(search);
  const edit = options?.edit ?? params.get("edit") === "1";
  const sidebarCollapsed = options?.sidebarCollapsed ?? params.get("sidebar") === "collapsed";
  params.delete("edit");
  params.delete("sidebar");
  if (edit) params.set("edit", "1");
  if (sidebarCollapsed) params.set("sidebar", "collapsed");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function parentFolder(path: string): string {
  if (!path.includes("/")) return "";
  return path.split("/").slice(0, -1).join("/");
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() || "";
}

function isEditable(path: string) {
  const ext = extension(path);
  return ["txt", "json", "md", "markdown", "log"].includes(ext);
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function PanelLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" strokeLinecap="round" />
    </svg>
  );
}

function PanelLeftCloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" strokeLinecap="round" />
      <path d="m14 9-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ToolbarIconButton({
  title,
  onClick,
  disabled,
  variant = "default",
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "destructive";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-40",
        variant === "default" && "bg-slate-900 text-white hover:bg-slate-800",
        variant === "outline" && "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        variant === "destructive" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function AgentFilesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlPath = parseFilesUrl(location.pathname);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlEditMode = searchParams.get("edit") === "1";
  const sidebarCollapsed = searchParams.get("sidebar") === "collapsed";

  const [currentFolder, setCurrentFolder] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedMeta, setSelectedMeta] = useState<{ size_bytes: number | null; modified_at: string | null }>({
    size_bytes: null,
    modified_at: null,
  });
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const breadcrumbSegments = useMemo(
    () => (currentFolder ? currentFolder.split("/").filter(Boolean) : []),
    [currentFolder],
  );

  const navigateWithQuery = useCallback(
    (path: string, options?: { edit?: boolean; sidebarCollapsed?: boolean; replace?: boolean }) => {
      navigate(`${filesUrl(path)}${filesQueryString(location.search, options)}`, {
        replace: options?.replace,
      });
    },
    [location.search, navigate],
  );

  const toggleSidebar = useCallback(() => {
    navigate(`${location.pathname}${filesQueryString(location.search, { sidebarCollapsed: !sidebarCollapsed })}`, {
      replace: true,
    });
  }, [location.pathname, location.search, navigate, sidebarCollapsed]);

  const fetchFolder = useCallback(async (folderPath = "") => {
    const res = await api.get<PathResponse>("/files", { params: { path: folderPath } });
    return res.data.children || [];
  }, []);

  const setEntriesWithDrafts = useCallback((nextEntries: FileEntry[]) => {
    setEntries(nextEntries);
    setDraftNames(Object.fromEntries(nextEntries.map((entry) => [entry.path, entry.name])));
  }, []);

  const syncFromUrl = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!urlPath) {
        setCurrentFolder("");
        setSelectedPath("");
        setSelectedMeta({ size_bytes: null, modified_at: null });
        setContent("");
        setDirty(false);
        setSaveStatus("idle");
        setViewMode(true);
        setEntriesWithDrafts(await fetchFolder(""));
        return;
      }

      const res = await api.get<PathResponse>("/files", { params: { path: urlPath } });
      if (res.data.is_dir) {
        setCurrentFolder(urlPath);
        setSelectedPath("");
        setSelectedMeta({ size_bytes: null, modified_at: null });
        setContent("");
        setDirty(false);
        setSaveStatus("idle");
        setViewMode(true);
        setEntriesWithDrafts(res.data.children || []);
        return;
      }

      const folder = parentFolder(urlPath);
      setCurrentFolder(folder);
      setSelectedPath(urlPath);
      setSelectedMeta({
        size_bytes: res.data.size_bytes ?? null,
        modified_at: res.data.modified_at ?? null,
      });
      setContent(res.data.content || "");
      setDirty(false);
      setSaveStatus("idle");
      setViewMode(!urlEditMode);
      setEntriesWithDrafts(await fetchFolder(folder));
    } catch {
      setLoadError("Could not load workspace. Run ./start-dev.sh to create ./.workspace");
      setEntries([]);
      setDraftNames({});
    } finally {
      setLoading(false);
    }
  }, [urlPath, urlEditMode, fetchFolder, setEntriesWithDrafts]);

  useEffect(() => {
    syncFromUrl().catch(console.error);
  }, [syncFromUrl]);

  const enterFolder = useCallback(
    (path: string) => {
      navigateWithQuery(path);
    },
    [navigateWithQuery],
  );

  const openFile = useCallback(
    (path: string, mode: "view" | "edit" = "view") => {
      navigateWithQuery(path, { edit: mode === "edit" });
    },
    [navigateWithQuery],
  );

  const setFileMode = useCallback(
    (mode: "view" | "edit") => {
      if (!selectedPath) return;
      navigateWithQuery(selectedPath, { edit: mode === "edit", replace: true });
    },
    [navigateWithQuery, selectedPath],
  );

  const editorExtensions = useMemo(() => {
    const ext = extension(selectedPath);
    const lang =
      ext === "json" ? [json()] : ext === "md" || ext === "markdown" ? [markdown()] : [];
    return [EditorView.lineWrapping, editorAutoHeight, ...lang];
  }, [selectedPath]);

  const reloadFolder = useCallback(async () => {
    setEntriesWithDrafts(await fetchFolder(currentFolder));
  }, [currentFolder, fetchFolder, setEntriesWithDrafts]);

  const saveFile = useCallback(async () => {
    if (!selectedPath || !dirty || !isEditable(selectedPath) || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      await api.put("/files", { path: selectedPath, content });
      setDirty(false);
      const res = await api.get<PathResponse>("/files", { params: { path: selectedPath } });
      setSelectedMeta({
        size_bytes: res.data.size_bytes ?? null,
        modified_at: res.data.modified_at ?? null,
      });
      await reloadFolder();
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("idle");
      throw err;
    }
  }, [selectedPath, dirty, content, saveStatus, reloadFolder]);

  useEffect(() => {
    if (viewMode || !selectedPath || !isEditable(selectedPath)) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && saveStatus !== "saving") {
          saveFile().catch(console.error);
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewMode, selectedPath, dirty, saveStatus, saveFile]);

  const commitEntryRename = async (entry: FileEntry) => {
    const trimmed = (draftNames[entry.path] ?? entry.name).trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === entry.name) {
      setDraftNames((prev) => ({ ...prev, [entry.path]: entry.name }));
      return;
    }
    const folder = parentFolder(entry.path);
    const newPath = folder ? `${folder}/${trimmed}` : trimmed;
    await api.put("/files", { old_path: entry.path, new_path: newPath });
    if (selectedPath === entry.path) {
      navigateWithQuery(newPath, { edit: !viewMode });
      return;
    }
    await reloadFolder();
  };

  const createNewFile = async () => {
    const name = newFileName.trim();
    if (!name) return;
    const path = currentFolder ? `${currentFolder}/${name}` : name;
    await api.post("/files", { path, content: "" });
    setNewFileName("");
    navigateWithQuery(path);
  };

  const renderFileContent = () => {
    if (!selectedPath) {
      return <p className="text-sm text-slate-500">Select a file to view or edit.</p>;
    }

    const ext = extension(selectedPath);

    if (viewMode) {
      if (ext === "md" || ext === "markdown") {
        return (
          <div className="overflow-x-auto text-sm leading-relaxed text-slate-900 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100 [&_table]:mb-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        );
      }

      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-sm text-slate-900">
          {content}
        </pre>
      );
    }

    if (!isEditable(selectedPath)) {
      return <p className="rounded bg-amber-50 p-3 text-sm">This file type is read-only in the editor.</p>;
    }

    return (
      <div className="min-w-0 max-w-full overflow-hidden rounded border">
        <CodeMirror
          value={content}
          theme={vscodeDark}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
          extensions={editorExtensions}
          onChange={(value) => {
            setContent(value);
            setDirty(true);
            setSaveStatus("idle");
          }}
        />
      </div>
    );
  };

  const renderFileSidebar = () => (
    <PanelCard className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-xs text-slate-600">
          <Link
            to={`${filesUrl()}${filesQueryString(location.search)}`}
            className="rounded px-0.5 hover:bg-slate-100 hover:text-slate-900"
          >
            .workspace
          </Link>
          {breadcrumbSegments.map((segment, index) => {
            const path = breadcrumbSegments.slice(0, index + 1).join("/");
            return (
              <span key={path} className="flex min-w-0 items-center gap-0.5">
                <span className="text-slate-400">/</span>
                <Link
                  to={`${filesUrl(path)}${filesQueryString(location.search)}`}
                  className="truncate rounded px-0.5 hover:bg-slate-100 hover:text-slate-900"
                >
                  {segment}
                </Link>
              </span>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={toggleSidebar}
          title="Collapse files panel"
          aria-label="Collapse files panel"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <PanelLeftCloseIcon />
        </button>
      </div>

      {loading ? (
        <p className="p-4 text-sm text-slate-500">Loading...</p>
      ) : (
        <ul className="divide-y text-sm">
          {currentFolder ? (
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-600 hover:bg-slate-50"
                onClick={() => enterFolder(parentFolder(currentFolder))}
              >
                <span className="w-4 shrink-0 text-xs">📁</span>
                <span className="min-w-0 flex-1 truncate">..</span>
              </button>
            </li>
          ) : null}

          {entries.map((entry) => (
            <li
              key={entry.path}
              className={cn(
                "px-3 py-1.5 hover:bg-slate-50",
                selectedPath === entry.path && "bg-slate-100",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-xs">{entry.is_dir ? "📁" : "📄"}</span>

                {entry.is_dir ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => enterFolder(entry.path)}
                  >
                    {entry.name}/
                  </button>
                ) : renamingPath === entry.path ? (
                  <Input
                    className="h-7 min-w-0 flex-1 px-1 text-sm"
                    value={draftNames[entry.path] ?? entry.name}
                    autoFocus
                    onChange={(e) => {
                      setDraftNames((prev) => ({ ...prev, [entry.path]: e.target.value }));
                    }}
                    onBlur={() => commitEntryRename(entry).catch(console.error)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                      if (e.key === "Escape") {
                        setRenamingPath(null);
                        setDraftNames((prev) => ({ ...prev, [entry.path]: entry.name }));
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left hover:text-slate-900"
                    title="View file (double-click to rename)"
                    onClick={() => openFile(entry.path, "view")}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      setRenamingPath(entry.path);
                    }}
                  >
                    {entry.name}
                  </button>
                )}

                {!entry.is_dir ? (
                  <span className="shrink-0 text-xs text-slate-400">{formatFileSize(entry.size_bytes)}</span>
                ) : null}
              </div>
            </li>
          ))}

          <li className="bg-slate-50/50 px-3 py-2">
            <Input
              className="h-7 border-dashed bg-white text-sm"
              placeholder="new-file.txt"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createNewFile().catch(console.error);
                }
              }}
            />
          </li>
        </ul>
      )}
    </PanelCard>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Agent Files</h1>

      {loadError ? <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">{loadError}</p> : null}

      <SplitPanelLayout sidebarClassName={sidebarCollapsed ? "md:hidden" : undefined} sidebar={renderFileSidebar()}>
        <div className="flex flex-col rounded-lg border bg-white">
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b px-2 py-1.5">
            {sidebarCollapsed ? (
              <ToolbarIconButton
                title="Expand files panel"
                variant="outline"
                onClick={toggleSidebar}
                className="hidden md:inline-flex"
              >
                <PanelLeftIcon />
              </ToolbarIconButton>
            ) : null}

            {selectedPath ? (
              <>
                <span className="shrink-0 text-sm font-semibold text-slate-800">{fileName(selectedPath)}</span>
                <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">|</span>
                <span className="shrink-0 text-xs text-slate-500">{formatFileSize(selectedMeta.size_bytes)}</span>
                <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">|</span>
                <span className="shrink-0 text-xs text-slate-500" title={selectedMeta.modified_at ?? undefined}>
                  {formatModified(selectedMeta.modified_at)}
                </span>
                {dirty ? (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    Unsaved
                  </span>
                ) : null}
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {viewMode ? (
                    isEditable(selectedPath) ? (
                      <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => setFileMode("edit")}>
                        Edit
                      </Button>
                    ) : null
                  ) : (
                    <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => setFileMode("view")}>
                      View
                    </Button>
                  )}
                  {!viewMode ? (
                    <Button
                      className="h-8 px-2.5 text-xs"
                      disabled={
                        saveStatus === "saving" ||
                        saveStatus === "saved" ||
                        !dirty ||
                        !isEditable(selectedPath)
                      }
                      onClick={() => saveFile().catch(console.error)}
                    >
                      {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
                    </Button>
                  ) : null}
                  <Button
                    variant="destructive"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => setDeleteTarget(selectedPath)}
                  >
                    Delete
                  </Button>
                </div>
              </>
            ) : (
              <span className="text-sm text-slate-500">Select a file to view or edit</span>
            )}
          </div>

          <div className="min-w-0 p-4">{renderFileContent()}</div>
        </div>
      </SplitPanelLayout>

      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete file?"
        confirmLabel="Delete"
        destructive
        description={
          <p>
            Delete file <strong>{deleteTarget ? fileName(deleteTarget) : ""}</strong>?
          </p>
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api.delete("/files", { data: { path: deleteTarget } });
          setDeleteTarget(null);
          if (selectedPath === deleteTarget) {
            navigateWithQuery(currentFolder);
            return;
          }
          await reloadFolder();
        }}
      />
    </div>
  );
}
