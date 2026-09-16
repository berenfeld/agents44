import { api, type Agent } from "@/api/client";
import {
  agentDefaultPromptPath,
  agentInputPath,
  fileName,
  isAgentMemoryFile,
  type FileEntry,
  type PathResponse,
} from "@/lib/workspace-files";

export type AgentPromptState = {
  agent: Agent;
  files: FileEntry[];
  selectedPath: string | null;
};

async function listPromptFiles(inputPath: string): Promise<FileEntry[]> {
  const res = await api.get<PathResponse>("/files", { params: { path: inputPath } });
  const files: FileEntry[] = [];
  for (const child of res.data.children || []) {
    if (child.is_dir) {
      files.push(...(await listPromptFiles(child.path)));
    } else if (!isAgentMemoryFile(child.path)) {
      files.push(child);
    }
  }
  return files;
}

export async function openAgentPrompt(agent: Agent): Promise<AgentPromptState> {
  const inputPath = agentInputPath(agent.department, agent.name);
  let files = await listPromptFiles(inputPath);
  if (files.length === 0) {
    const path = agentDefaultPromptPath(agent.department, agent.name);
    await api.post("/files", { path, content: "" });
    files = [
      {
        path,
        name: fileName(path),
        is_dir: false,
        size_bytes: 0,
        modified_at: new Date().toISOString(),
      },
    ];
  }
  return {
    agent,
    files,
    selectedPath: files.length === 1 ? files[0].path : null,
  };
}
