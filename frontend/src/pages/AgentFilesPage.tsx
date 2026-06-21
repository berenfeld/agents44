import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
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

const editorAutoHeight = EditorView.theme({
  "&": { height: "auto !important" },
  ".cm-scroller": { overflow: "visible !important", height: "auto !important" },
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

function defaultsToViewMode(path: string) {
  const ext = extension(path);
  return ext === "md" || ext === "markdown" || ext === "log";
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

function EyeIcon() {
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
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PencilIcon() {
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
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function FileActionButton({
  title,
  label,
  onClick,
  children,
}: {
  title: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      title={title}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function AgentFilesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlPath = parseFilesUrl(location.pathname);
  const urlEditMode = new URLSearchParams(location.search).get("edit") === "1";

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
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState(true);

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
        setViewMode(true);
        setEntriesWithDrafts(await fetchFolder(""));
        return;
      }

      const res = await api.get<PathResponse>("/files", { params: { path: urlPath } });
      if (res.data.is_dir) {
        setCurrentFolder(urlPath);
        setSelectedPath("");
        setContent("");
        setDirty(false);
        setViewMode(true);
        setEntriesWithDrafts(res.data.children || []);
        return;
      }

      const folder = parentFolder(urlPath);
      setCurrentFolder(folder);
      setSelectedPath(urlPath);
      setContent(res.data.content || "");
      setDirty(false);
      setViewMode(urlEditMode || !defaultsToViewMode(urlPath));
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
      navigate(filesUrl(path));
    },
    [navigate],
  );

  const openFile = useCallback(
    (path: string, mode: "view" | "edit" = "view") => {
      const url = filesUrl(path);
      navigate(mode === "edit" ? `${url}?edit=1` : url);
    },
    [navigate],
  );

  const setFileMode = useCallback(
    (mode: "view" | "edit") => {
      if (!selectedPath) return;
      const url = filesUrl(selectedPath);
      navigate(mode === "edit" ? `${url}?edit=1` : url, { replace: true });
    },
    [navigate, selectedPath],
  );

  const editorExtensions = useMemo(() => {
    const ext = extension(selectedPath);
    const lang =
      ext === "json" ? [json()] : ext === "md" || ext === "markdown" ? [markdown()] : [];
    return [editorAutoHeight, ...lang];
  }, [selectedPath]);

  const reloadFolder = async () => {
    setEntriesWithDrafts(await fetchFolder(currentFolder));
  };

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

  const renderFileContent = () => {
    const ext = extension(selectedPath);

    if (viewMode) {
      if (ext === "md" || ext === "markdown") {
        return (
          <div className="rounded border bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 [&_code]:rounded [&_code]:bg-slate-200 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        );
      }

      return (
        <pre className="whitespace-pre-wrap break-words rounded border bg-slate-950 p-4 font-mono text-sm text-slate-100">
          {content}
        </pre>
      );
    }

    if (!isEditable(selectedPath)) {
      return <p className="rounded bg-amber-50 p-3 text-sm">This file type is read-only in the editor.</p>;
    }

    return (
      <CodeMirror
        value={content}
        theme={vscodeDark}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
        extensions={editorExtensions}
        onChange={(value) => {
          setContent(value);
          setDirty(true);
        }}
      />
    );
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-white lg:col-span-1">
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
                    "flex items-center gap-1 px-3 py-2 hover:bg-slate-50",
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
                  ) : renamingPath === entry.path ? (
                    <Input
                      className="h-8 min-w-0 flex-1 px-1 text-sm"
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

                  <span className="shrink-0 text-xs text-slate-500">{formatFileSize(entry.size_bytes)}</span>

                  {!entry.is_dir ? (
                    <>
                      <FileActionButton
                        title="View file"
                        label={`View ${entry.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openFile(entry.path, "view");
                        }}
                      >
                        <EyeIcon />
                      </FileActionButton>
                      {isEditable(entry.path) ? (
                        <FileActionButton
                          title="Edit file"
                          label={`Edit ${entry.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openFile(entry.path, "edit");
                          }}
                        >
                          <PencilIcon />
                        </FileActionButton>
                      ) : null}
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
                    </>
                  ) : (
                    <span className="w-[4.5rem] shrink-0" />
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

        <div className="space-y-3 rounded-lg border bg-white p-4 lg:col-span-2">
          {!selectedPath ? (
            <p className="text-sm text-slate-500">Select a file to view or edit.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm text-slate-600">{selectedPath}</p>
                <div className="flex shrink-0 items-center gap-2">
                  {viewMode ? (
                    isEditable(selectedPath) ? (
                      <Button variant="outline" onClick={() => setFileMode("edit")}>
                        Edit
                      </Button>
                    ) : null
                  ) : (
                    <Button variant="outline" onClick={() => setFileMode("view")}>
                      View
                    </Button>
                  )}
                  {!viewMode ? (
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
                  ) : null}
                </div>
              </div>

              {renderFileContent()}
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
