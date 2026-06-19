import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Button, Input } from "@/components/ui/primitives";
import { ConfirmModal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type FileEntry = { path: string; name: string; is_dir: boolean; size_bytes: number | null };
type PathResponse = {
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
  content?: string;
  size_bytes?: number;
};

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

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export default function AgentFilesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlPath = parseFilesUrl(location.pathname);

  const [currentFolder, setCurrentFolder] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const breadcrumbSegments = useMemo(
    () => (currentFolder ? currentFolder.split("/").filter(Boolean) : []),
    [currentFolder],
  );

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
        setContent("");
        setDirty(false);
        setEntriesWithDrafts(await fetchFolder(""));
        return;
      }

      const res = await api.get<PathResponse>("/files", { params: { path: urlPath } });
      if (res.data.is_dir) {
        setCurrentFolder(urlPath);
        setSelectedPath("");
        setContent("");
        setDirty(false);
        setEntriesWithDrafts(res.data.children || []);
        return;
      }

      const folder = parentFolder(urlPath);
      setCurrentFolder(folder);
      setSelectedPath(urlPath);
      setContent(res.data.content || "");
      setDirty(false);
      setEntriesWithDrafts(await fetchFolder(folder));
    } catch {
      setLoadError("Could not load workspace. Run ./start-dev.sh to create ./.workspace");
      setEntries([]);
      setDraftNames({});
    } finally {
      setLoading(false);
    }
  }, [urlPath, fetchFolder, setEntriesWithDrafts]);

  useEffect(() => {
    syncFromUrl().catch(console.error);
  }, [syncFromUrl]);

  const enterFolder = useCallback(
    (path: string) => {
      navigate(filesUrl(path));
    },
    [navigate],
  );

  const openFile = useCallback(
    (path: string) => {
      navigate(filesUrl(path));
    },
    [navigate],
  );

  const editorExtensions = useMemo(() => {
    const ext = extension(selectedPath);
    if (ext === "json") return [json()];
    if (ext === "md" || ext === "markdown") return [markdown()];
    return [];
  }, [selectedPath]);

  const reloadFolder = async () => {
    setEntriesWithDrafts(await fetchFolder(currentFolder));
  };

  const commitEntryRename = async (entry: FileEntry) => {
    const trimmed = (draftNames[entry.path] ?? entry.name).trim();
    if (!trimmed || trimmed === entry.name) {
      setDraftNames((prev) => ({ ...prev, [entry.path]: entry.name }));
      return;
    }
    const folder = parentFolder(entry.path);
    const newPath = folder ? `${folder}/${trimmed}` : trimmed;
    await api.put("/files", { old_path: entry.path, new_path: newPath });
    if (selectedPath === entry.path) {
      navigate(filesUrl(newPath));
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
    navigate(filesUrl(path));
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Agent Files</h1>

      <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
        <Link to={filesUrl()} className="rounded px-1 hover:bg-slate-100 hover:text-slate-900">
          .workspace
        </Link>
        {breadcrumbSegments.map((segment, index) => {
          const path = breadcrumbSegments.slice(0, index + 1).join("/");
          return (
            <span key={path} className="flex items-center gap-1">
              <span>/</span>
              <Link to={filesUrl(path)} className="rounded px-1 hover:bg-slate-100 hover:text-slate-900">
                {segment}
              </Link>
            </span>
          );
        })}
      </nav>

      {loadError ? <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">{loadError}</p> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-white">
          <div className="border-b px-3 py-2">
            <p className="text-sm font-medium text-slate-700">
              {currentFolder ? `${currentFolder}/` : ".workspace/"}
            </p>
          </div>

          {loading ? (
            <p className="p-4 text-sm text-slate-500">Loading...</p>
          ) : (
            <ul className="divide-y text-sm">
              {currentFolder ? (
                <li>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-600 hover:bg-slate-50"
                    onClick={() => enterFolder(parentFolder(currentFolder))}
                  >
                    <span className="w-5">📁</span>
                    <span className="min-w-0 flex-1">..</span>
                    <span className="shrink-0 text-xs text-slate-400">—</span>
                  </button>
                </li>
              ) : null}

              {entries.map((entry) => (
                <li
                  key={entry.path}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 hover:bg-slate-50",
                    selectedPath === entry.path && "bg-slate-100",
                  )}
                >
                  <span className="w-5 shrink-0">{entry.is_dir ? "📁" : "📄"}</span>

                  {entry.is_dir ? (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => enterFolder(entry.path)}
                    >
                      {entry.name}/
                    </button>
                  ) : (
                    <Input
                      className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1 shadow-none focus-visible:border-slate-300 focus-visible:ring-0"
                      value={draftNames[entry.path] ?? entry.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        openFile(entry.path);
                      }}
                      onChange={(e) => {
                        setDraftNames((prev) => ({ ...prev, [entry.path]: e.target.value }));
                      }}
                      onBlur={() => commitEntryRename(entry).catch(console.error)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  )}

                  <span className="shrink-0 text-xs text-slate-500">{formatFileSize(entry.size_bytes)}</span>

                  {!entry.is_dir ? (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete file"
                      aria-label={`Delete ${entry.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(entry.path);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  ) : (
                    <span className="w-6 shrink-0" />
                  )}
                </li>
              ))}

              <li className="bg-slate-50/50 px-3 py-2">
                <Input
                  className="h-8 border-dashed bg-white text-sm"
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
        </div>

        <div className="space-y-3 rounded-lg border bg-white p-4">
          {!selectedPath ? (
            <p className="text-sm text-slate-500">Select a file to view or edit.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm text-slate-600">{selectedPath}</p>
                <Button
                  disabled={!dirty || !isEditable(selectedPath)}
                  onClick={async () => {
                    await api.put("/files", { path: selectedPath, content });
                    setDirty(false);
                    await reloadFolder();
                  }}
                >
                  Save
                </Button>
              </div>

              {!isEditable(selectedPath) ? (
                <p className="rounded bg-amber-50 p-3 text-sm">This file type is read-only in the editor.</p>
              ) : (
                <CodeMirror
                  value={content}
                  height="420px"
                  theme={vscodeDark}
                  extensions={editorExtensions}
                  onChange={(value) => {
                    setContent(value);
                    setDirty(true);
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>

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
            navigate(filesUrl(currentFolder));
            return;
          }
          await reloadFolder();
        }}
      />
    </div>
  );
}
