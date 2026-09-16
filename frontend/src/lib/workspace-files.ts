export type FileEntry = {
  path: string;
  name: string;
  is_dir: boolean;
  size_bytes: number | null;
  modified_at: string | null;
};

export type PathResponse = {
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
  content?: string;
  size_bytes?: number | null;
  modified_at?: string | null;
};

export type TextDirection = "ltr" | "rtl";

export const AGENT_MEMORY_FILE = "MEMORY.md";
export const DEFAULT_PROMPT_FILE = "task.md";
export const TEXT_DIRECTION_STORAGE_KEY = "agents44.agentFiles.textDirection";

export function agentInputPath(department: string, agentName: string): string {
  return `${department}/${agentName}/input`;
}

export function agentDefaultPromptPath(department: string, agentName: string): string {
  return `${agentInputPath(department, agentName)}/${DEFAULT_PROMPT_FILE}`;
}

export function isAgentMemoryFile(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 3 && parts[1] === "input" && parts[2] === AGENT_MEMORY_FILE) return true;
  if (parts.length === 4 && parts[2] === "input" && parts[3] === AGENT_MEMORY_FILE) return true;
  return false;
}

export function isProtectedWorkspacePath(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 2 && parts[1] === "input") return true;
  if (parts.length === 3 && parts[2] === "input") return true;
  if (parts.length === 3 && parts[1] === "input" && parts[2] === AGENT_MEMORY_FILE) return true;
  if (parts.length === 4 && parts[2] === "input" && parts[3] === AGENT_MEMORY_FILE) return true;
  return false;
}

export function parentFolder(path: string): string {
  if (!path.includes("/")) return "";
  return path.split("/").slice(0, -1).join("/");
}

export function isUnderPath(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function fileName(path: string): string {
  return path.split("/").pop() || path;
}

export function extension(path: string) {
  const name = fileName(path);
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return name.slice(lastDot + 1).toLowerCase();
}

export function isEditable(path: string) {
  const ext = extension(path);
  if (!ext) return true;
  return ["txt", "json", "md", "markdown", "log"].includes(ext);
}

export function isTextOrMarkdownFile(path: string) {
  const ext = extension(path);
  return !ext || ext === "txt" || ext === "md" || ext === "markdown";
}

export function isPdfFile(path: string) {
  return extension(path) === "pdf";
}

export function readTextDirection(): TextDirection {
  try {
    return window.localStorage.getItem(TEXT_DIRECTION_STORAGE_KEY) === "rtl" ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}

export function writeTextDirection(direction: TextDirection) {
  try {
    window.localStorage.setItem(TEXT_DIRECTION_STORAGE_KEY, direction);
  } catch {
    // Ignore storage failures (private mode, quota). The in-memory toggle still works.
  }
}

export function fileRawUrl(path: string, download = false) {
  const apiBase = String(import.meta.env.REACT_APP_API_URL || "/api").replace(/\/$/, "");
  const params = new URLSearchParams({ path });
  if (download) params.set("download", "1");
  return `${apiBase}/files/raw?${params.toString()}`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatModified(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function promptFileLabel(inputPath: string, filePath: string): string {
  const prefix = `${inputPath}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : fileName(filePath);
}
