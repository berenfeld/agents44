import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, userFacingApiError } from "@/api/client";
import { Button, Input } from "@/components/ui/primitives";
import { ConfirmModal, Modal, NoticeModal } from "@/components/ui/modal";
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

function isProtectedWorkspacePath(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 2 && parts[1] === "input") return true;
  if (parts.length === 3 && parts[2] === "input") return true;
  if (parts.length === 3 && parts[1] === "input" && parts[2] === "MEMORY.md") return true;
  if (parts.length === 4 && parts[2] === "input" && parts[3] === "MEMORY.md") return true;
  return false;
}

function parentFolder(path: string): string {
  if (!path.includes("/")) return "";
  return path.split("/").slice(0, -1).join("/");
}

function isUnderPath(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function extension(path: string) {
  const name = fileName(path);
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return name.slice(lastDot + 1).toLowerCase();
}

function isEditable(path: string) {
  const ext = extension(path);
  if (!ext) return true;
  return ["txt", "json", "md", "markdown", "log"].includes(ext);
}

function isPdfFile(path: string) {
  return extension(path) === "pdf";
}

function fileRawUrl(path: string, download = false) {
  const apiBase = String(import.meta.env.REACT_APP_API_URL || "/api").replace(/\/$/, "");
  const params = new URLSearchParams({ path });
  if (download) params.set("download", "1");
  return `${apiBase}/files/raw?${params.toString()}`;
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function formatFolderSummary(entries: FileEntry[]): string {
  const folders = entries.filter((entry) => entry.is_dir).length;
  const files = entries.length - folders;
  return `${formatCount(files, "file", "files")}, ${formatCount(folders, "folder", "folders")}`;
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

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("h-4 w-4", className)} aria-hidden="true">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("h-4 w-4", className)} aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("h-4 w-4", className)} aria-hidden="true">
      <path d="M12 3v12M8 11l4 4 4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
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
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fileToRename, setFileToRename] = useState<FileEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
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

  const openRename = useCallback((entry: FileEntry) => {
    setFileToRename(entry);
    setRenameDraft(entry.name);
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
        setEntries(await fetchFolder(""));
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
        setEntries(res.data.children || []);
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
      setViewMode(isPdfFile(urlPath) ? true : !urlEditMode);
      setEntries(await fetchFolder(folder));
    } catch {
      setLoadError("Could not load workspace. Run ./start-dev.sh to create ./.workspace");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [urlPath, urlEditMode, fetchFolder]);

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
    setEntries(await fetchFolder(currentFolder));
  }, [currentFolder, fetchFolder]);

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

  const renameFile = async () => {
    if (!fileToRename || renaming) return;
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === fileToRename.name) {
      setFileToRename(null);
      setRenameDraft("");
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setNotice({ title: "Could not rename file", message: "Name cannot contain slashes." });
      return;
    }
    const folder = parentFolder(fileToRename.path);
    const newPath = folder ? `${folder}/${trimmed}` : trimmed;
    setRenaming(true);
    try {
      await api.put("/files", { old_path: fileToRename.path, new_path: newPath });
      const wasSelected = selectedPath === fileToRename.path;
      setFileToRename(null);
      setRenameDraft("");
      setNotice({ title: "File renamed", message: `Renamed to ${trimmed}.` });
      if (wasSelected) {
        navigateWithQuery(newPath, { edit: !viewMode });
        return;
      }
      await reloadFolder();
    } catch (err) {
      setNotice({ title: "Could not rename file", message: userFacingApiError(err) });
    } finally {
      setRenaming(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.delete("/files", { data: { path: deleteTarget.path } });
      const target = deleteTarget;
      setDeleteTarget(null);
      setNotice({
        title: target.is_dir ? "Folder deleted" : "File deleted",
        message: `Deleted ${target.name}.`,
      });
      if (
        isUnderPath(urlPath, target.path) ||
        isUnderPath(selectedPath, target.path) ||
        isUnderPath(currentFolder, target.path)
      ) {
        navigateWithQuery(parentFolder(target.path));
        return;
      }
      setEntries((rows) => rows.filter((row) => row.path !== target.path));
    } catch (err) {
      const isDir = deleteTarget.is_dir;
      setDeleteTarget(null);
      setNotice({
        title: isDir ? "Could not delete folder" : "Could not delete file",
        message: userFacingApiError(err),
      });
    } finally {
      setDeleting(false);
    }
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

    if (isPdfFile(selectedPath)) {
      return (
        <iframe
          key={selectedPath}
          title={fileName(selectedPath)}
          src={fileRawUrl(selectedPath)}
          className="h-full min-h-[480px] w-full border-0 bg-slate-100"
        />
      );
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
      <div className="border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
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
        {loading ? null : (
          <p className="mt-1 text-xs text-slate-500">{formatFolderSummary(entries)}</p>
        )}
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
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left hover:text-slate-900"
                    title="View file"
                    onClick={() => openFile(entry.path, "view")}
                  >
                    {entry.name}
                  </button>
                )}

                {!entry.is_dir ? (
                  <span className="shrink-0 text-xs text-slate-400">{formatFileSize(entry.size_bytes)}</span>
                ) : null}

                {!entry.is_dir && !isProtectedWorkspacePath(entry.path) ? (
                  <button
                    type="button"
                    title={`Rename ${entry.name}`}
                    aria-label={`Rename ${entry.name}`}
                    disabled={renaming}
                    onClick={() => openRename(entry)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                ) : null}

                {!isProtectedWorkspacePath(entry.path) ? (
                  <button
                    type="button"
                    title={`Delete ${entry.name}`}
                    aria-label={`Delete ${entry.name}`}
                    disabled={deleting}
                    onClick={() => setDeleteTarget(entry)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
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

      <SplitPanelLayout
        sidebarWidthKey="agents44.agentFiles.sidebarWidth"
        sidebarCollapsed={sidebarCollapsed}
        sidebar={renderFileSidebar()}
      >
        <div
          className={cn(
            "flex flex-col rounded-lg border bg-white",
            selectedPath && isPdfFile(selectedPath) && "md:h-[calc(100vh-11rem)]",
          )}
        >
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
                  {isPdfFile(selectedPath) ? (
                    <a
                      href={fileRawUrl(selectedPath, true)}
                      download={fileName(selectedPath)}
                      title="Download PDF"
                      aria-label="Download PDF"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      <DownloadIcon />
                    </a>
                  ) : null}
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
                  {!isProtectedWorkspacePath(selectedPath) ? (
                    <Button
                      variant="outline"
                      className="h-8 px-2.5 text-xs"
                      disabled={renaming}
                      onClick={() => {
                        const entry =
                          entries.find((item) => item.path === selectedPath) ?? {
                            path: selectedPath,
                            name: fileName(selectedPath),
                            is_dir: false,
                            size_bytes: selectedMeta.size_bytes,
                            modified_at: selectedMeta.modified_at,
                          };
                        openRename(entry);
                      }}
                    >
                      Rename
                    </Button>
                  ) : null}
                  {!isProtectedWorkspacePath(selectedPath) ? (
                    <ToolbarIconButton
                      title="Delete file"
                      variant="destructive"
                      disabled={deleting}
                      onClick={() => {
                        const entry =
                          entries.find((item) => item.path === selectedPath) ?? {
                            path: selectedPath,
                            name: fileName(selectedPath),
                            is_dir: false,
                            size_bytes: selectedMeta.size_bytes,
                            modified_at: selectedMeta.modified_at,
                          };
                        setDeleteTarget(entry);
                      }}
                    >
                      <TrashIcon />
                    </ToolbarIconButton>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <span className="min-w-0 truncate text-sm text-slate-500">
                  {currentFolder ? fileName(currentFolder) : "Select a file to view or edit"}
                </span>
                {currentFolder && !isProtectedWorkspacePath(currentFolder) ? (
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <ToolbarIconButton
                      title="Delete folder"
                      variant="destructive"
                      disabled={deleting}
                      onClick={() =>
                        setDeleteTarget({
                          path: currentFolder,
                          name: fileName(currentFolder),
                          is_dir: true,
                          size_bytes: null,
                          modified_at: null,
                        })
                      }
                    >
                      <TrashIcon />
                    </ToolbarIconButton>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div
            className={cn(
              "min-w-0",
              selectedPath && isPdfFile(selectedPath) ? "min-h-0 flex-1 p-0" : "p-4",
            )}
          >
            {renderFileContent()}
          </div>
        </div>
      </SplitPanelLayout>

      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
        title={deleteTarget?.is_dir ? "Delete folder?" : "Delete file?"}
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        destructive
        busy={deleting}
        description={
          deleteTarget ? (
            deleteTarget.is_dir ? (
              <p>
                Delete folder <strong>{deleteTarget.name}</strong> and everything inside it? This cannot be undone.
              </p>
            ) : (
              <p>
                Delete file <strong>{deleteTarget.name}</strong>?
              </p>
            )
          ) : null
        }
        onConfirm={() => {
          void confirmDelete();
        }}
      />
      <Modal
        open={!!fileToRename}
        onOpenChange={(open) => {
          if (!open && !renaming) {
            setFileToRename(null);
            setRenameDraft("");
          }
        }}
        title="Rename file"
      >
        {fileToRename ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Rename <strong>{fileToRename.name}</strong> to a new file name in the same folder.
            </p>
            <div>
              <label htmlFor="rename-file-input" className="mb-1 block text-sm font-medium text-slate-700">
                New name
              </label>
              <Input
                id="rename-file-input"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                placeholder="file.md"
                autoFocus
                disabled={renaming}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && renameDraft.trim() && !renaming) {
                    renameFile().catch(console.error);
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={renaming}
                onClick={() => {
                  setFileToRename(null);
                  setRenameDraft("");
                }}
              >
                Cancel
              </Button>
              <Button disabled={!renameDraft.trim() || renaming} onClick={() => renameFile().catch(console.error)}>
                {renaming ? "Renaming..." : "Rename"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? <p>{notice.message}</p> : null}
      />
    </div>
  );
}
