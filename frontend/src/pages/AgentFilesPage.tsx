import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, userFacingApiError } from "@/api/client";
import { FileEditorPane } from "@/components/files/FileEditorPane";
import { Button, Input } from "@/components/ui/primitives";
import { ConfirmModal, Modal, NoticeModal } from "@/components/ui/modal";
import { PanelCard, SplitPanelLayout } from "@/components/ui/split-panel-layout";
import {
  fileName,
  formatFileSize,
  isEditable,
  isPdfFile,
  isProtectedWorkspacePath,
  isUnderPath,
  parentFolder,
  readTextDirection,
  writeTextDirection,
  type FileEntry,
  type PathResponse,
  type TextDirection,
} from "@/lib/workspace-files";
import { cn } from "@/lib/utils";

const FILES_ROUTE_PREFIX = "/agents_files";

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

type PendingUpload = {
  files: File[];
  skippedFolders: boolean;
};

function formatCount(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function dragHasFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

function filesFromDataTransfer(dataTransfer: DataTransfer): { files: File[]; skippedFolders: boolean } {
  const items = Array.from(dataTransfer.items || []);
  if (!items.length) {
    return { files: Array.from(dataTransfer.files || []), skippedFolders: false };
  }
  const files: File[] = [];
  let skippedFolders = false;
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }
    ).webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      skippedFolders = true;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, skippedFolders };
}

function uploadErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 413) return "File is larger than 50 MB";
  }
  return userFacingApiError(err);
}

async function uploadWorkspaceFile(folder: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("path", folder);
  body.append("file", file, file.name);
  const res = await api.post<{ path: string }>("/files/upload", body, {
    headers: { "Content-Type": "multipart/form-data" },
    transformRequest: [
      (data, headers) => {
        if (headers && typeof headers === "object" && "delete" in headers && typeof headers.delete === "function") {
          headers.delete("Content-Type");
        }
        return data;
      },
    ],
  });
  return res.data.path;
}

function formatFolderSummary(entries: FileEntry[]): string {
  const folders = entries.filter((entry) => entry.is_dir).length;
  const files = entries.length - folders;
  return `${formatCount(files, "file", "files")}, ${formatCount(folders, "folder", "folders")}`;
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
  const [uploading, setUploading] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const uploadingRef = useRef(false);
  const currentFolderRef = useRef(currentFolder);
  const [viewMode, setViewMode] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [textDirection, setTextDirection] = useState<TextDirection>(readTextDirection);

  const setFileTextDirection = useCallback((direction: TextDirection) => {
    setTextDirection(direction);
    writeTextDirection(direction);
  }, []);

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
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);

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
      setNotice({ title: "Could not save file", message: userFacingApiError(err) });
    }
  }, [selectedPath, dirty, content, saveStatus, reloadFolder]);

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

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || uploadingRef.current) return;
      const folder = currentFolderRef.current;
      uploadingRef.current = true;
      setUploading(true);
      const failures: string[] = [];
      const uploadedPaths: string[] = [];
      try {
        for (const file of files) {
          try {
            uploadedPaths.push(await uploadWorkspaceFile(folder, file));
          } catch (err) {
            failures.push(`${file.name}: ${uploadErrorMessage(err)}`);
          }
        }
        const openedSingle = uploadedPaths.length === 1 && failures.length === 0;
        if (!openedSingle && uploadedPaths.length && currentFolderRef.current === folder) {
          try {
            setEntries(await fetchFolder(folder));
          } catch (err) {
            setNotice({ title: "Could not refresh the file list", message: userFacingApiError(err) });
            return;
          }
        }
        if (failures.length && uploadedPaths.length) {
          setNotice({
            title: "Some files were not uploaded",
            message: `Uploaded ${uploadedPaths.length} of ${files.length}. ${failures.join(" ")}`,
          });
        } else if (failures.length) {
          setNotice({ title: "Could not upload", message: failures.join(" ") });
        } else if (openedSingle) {
          setNotice({ title: "File uploaded", message: `Uploaded ${files[0].name}.` });
        } else {
          setNotice({
            title: "Files uploaded",
            message: `Uploaded ${formatCount(uploadedPaths.length, "file", "files")}.`,
          });
        }
        if (openedSingle && currentFolderRef.current === folder) {
          navigateWithQuery(uploadedPaths[0]);
        }
      } finally {
        uploadingRef.current = false;
        setUploading(false);
        setPendingUpload(null);
      }
    },
    [fetchFolder, navigateWithQuery],
  );

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    void uploadFiles(files);
  };

  const onSidebarDragEnter = (event: React.DragEvent) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    if (!uploading && !pendingUpload && !loading) setDragOver(true);
  };

  const onSidebarDragOver = (event: React.DragEvent) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = uploading || pendingUpload || loading ? "none" : "copy";
  };

  const onSidebarDragLeave = (event: React.DragEvent) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const onSidebarDrop = (event: React.DragEvent) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (uploading || pendingUpload || loading) return;
    const dropped = filesFromDataTransfer(event.dataTransfer);
    if (!dropped.files.length) {
      setNotice({
        title: "Could not upload",
        message: dropped.skippedFolders ? "Folders cannot be uploaded. Drop files instead." : "No files to upload.",
      });
      return;
    }
    setPendingUpload(dropped);
  };

  const renderFileSidebar = () => (
    <div
      className="h-full"
      onDragEnter={onSidebarDragEnter}
      onDragOver={onSidebarDragOver}
      onDragLeave={onSidebarDragLeave}
      onDrop={onSidebarDrop}
    >
    <PanelCard className={cn("relative flex h-full flex-col", dragOver && "ring-2 ring-inset ring-slate-900")}>
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 text-sm font-medium text-slate-800">
          Drop to upload
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFileInputChange}
      />
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
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              className="h-7 px-2 text-xs"
              title="Upload files into this folder"
              aria-busy={uploading}
              disabled={loading || uploading || !!pendingUpload}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading..." : "Upload"}
            </Button>
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
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Files</h1>

      {loadError ? <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">{loadError}</p> : null}

      <SplitPanelLayout
        sidebarWidthKey="agents44.agentFiles.sidebarWidth"
        sidebarCollapsed={sidebarCollapsed}
        sidebar={renderFileSidebar()}
      >
        {selectedPath ? (
          <FileEditorPane
            path={selectedPath}
            content={content}
            sizeBytes={selectedMeta.size_bytes}
            modifiedAt={selectedMeta.modified_at}
            dirty={dirty}
            saveStatus={saveStatus}
            viewMode={viewMode}
            textDirection={textDirection}
            onContentChange={(value) => {
              setContent(value);
              setDirty(true);
              setSaveStatus("idle");
            }}
            onViewModeChange={(nextViewMode) => setFileMode(nextViewMode ? "view" : "edit")}
            onTextDirectionChange={setFileTextDirection}
            onSave={() => {
              void saveFile();
            }}
            toolbarStart={
              sidebarCollapsed ? (
                <ToolbarIconButton
                  title="Expand files panel"
                  variant="outline"
                  onClick={toggleSidebar}
                  className="hidden md:inline-flex"
                >
                  <PanelLeftIcon />
                </ToolbarIconButton>
              ) : null
            }
            toolbarExtra={
              <>
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
              </>
            }
          />
        ) : (
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
            </div>
            <div className="min-w-0 p-4">
              <p className="text-sm text-slate-500">Select a file to view or edit.</p>
            </div>
          </div>
        )}
      </SplitPanelLayout>

      <ConfirmModal
        open={!!pendingUpload}
        onOpenChange={(open) => !open && !uploading && setPendingUpload(null)}
        title={pendingUpload && pendingUpload.files.length === 1 ? "Upload file?" : "Upload files?"}
        confirmLabel={uploading ? "Uploading..." : "Upload"}
        busy={uploading}
        description={
          pendingUpload ? (
            <div className="space-y-2">
              <p>
                {pendingUpload.files.length === 1 ? (
                  <>
                    Upload <strong>{pendingUpload.files[0].name}</strong> into{" "}
                    <strong>{currentFolder || ".workspace"}</strong>?
                  </>
                ) : (
                  <>
                    Upload <strong>{formatCount(pendingUpload.files.length, "file", "files")}</strong> into{" "}
                    <strong>{currentFolder || ".workspace"}</strong>?
                  </>
                )}
              </p>
              {pendingUpload.files.length > 1 ? (
                <ul className="list-disc space-y-0.5 ps-5">
                  {pendingUpload.files.slice(0, 8).map((file, index) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>{file.name}</li>
                  ))}
                </ul>
              ) : null}
              {pendingUpload.files.length > 8 ? <p>and {pendingUpload.files.length - 8} more</p> : null}
              {pendingUpload.skippedFolders ? <p>Folders in the drop were skipped.</p> : null}
            </div>
          ) : null
        }
        onConfirm={() => {
          if (pendingUpload) void uploadFiles(pendingUpload.files);
        }}
      />
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
        description={notice ? <p className="whitespace-pre-wrap">{notice.message}</p> : null}
      />
    </div>
  );
}
