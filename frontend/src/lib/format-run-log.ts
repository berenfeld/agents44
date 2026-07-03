type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function truncate(text: string, maxLength = 500): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}… (${text.length - maxLength} more chars)`;
}

function indentBlock(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function formatKeyValues(input: JsonRecord, keys: string[]): string[] {
  const lines: string[] = [];
  for (const key of keys) {
    const value = input[key];
    if (value == null || value === "") continue;
    if (typeof value === "object") {
      lines.push(`${key}: ${truncate(JSON.stringify(value))}`);
    } else {
      lines.push(`${key}: ${asString(value)}`);
    }
  }
  return lines;
}

function formatGenericInput(input: JsonRecord): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === "") continue;
    if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${key}:`);
      lines.push(indentBlock(truncate(value, 800)));
    } else if (typeof value === "object") {
      lines.push(`${key}: ${truncate(JSON.stringify(value))}`);
    } else {
      lines.push(`${key}: ${asString(value)}`);
    }
  }
  return lines;
}

function formatToolUse(name: string, input: JsonRecord): string[] {
  switch (name) {
    case "WebSearch":
      return formatKeyValues(input, ["search_term", "explanation"]);
    case "WebFetch":
      return formatKeyValues(input, ["url", "explanation"]);
    case "Bash":
      return input.command ? [`$ ${asString(input.command)}`] : formatGenericInput(input);
    case "Read":
      return formatKeyValues(input, ["path", "file_path", "offset", "limit"]);
    case "Write":
    case "Edit":
    case "StrReplace":
      return formatKeyValues(input, ["path", "file_path", "old_string", "new_string"]);
    case "Glob":
      return formatKeyValues(input, ["glob_pattern", "target_directory"]);
    case "Grep":
      return formatKeyValues(input, ["pattern", "path", "glob", "type", "-i"]);
    case "Task":
      return formatKeyValues(input, ["description", "subagent_type", "model", "prompt"]);
    case "ToolSearch":
      return formatKeyValues(input, ["query", "max_results"]);
    case "NotebookEdit":
      return formatKeyValues(input, ["target_notebook", "cell_idx", "is_new_cell", "cell_language"]);
    case "AskUserQuestion":
      return ["(asking user a question)"];
    case "Skill":
      return formatKeyValues(input, ["skill", "args"]);
    default:
      return formatGenericInput(input);
  }
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return truncate(JSON.stringify(content));

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    const itemType = item.type;
    if (itemType === "text" && typeof item.text === "string") {
      parts.push(item.text);
    } else if (itemType === "tool_reference" && typeof item.tool_name === "string") {
      parts.push(`→ ${item.tool_name}`);
    } else {
      parts.push(truncate(JSON.stringify(item)));
    }
  }
  return parts.join("\n");
}

function formatToolResult(content: unknown, toolUseResult: unknown): string[] {
  const lines: string[] = [];
  if (isRecord(toolUseResult)) {
    const matches = toolUseResult.matches;
    const query = toolUseResult.query;
    if (Array.isArray(matches) && matches.length > 0) {
      lines.push(`Matches: ${matches.map(asString).join(", ")}`);
    }
    if (query) {
      lines.push(`Query: ${asString(query)}`);
    }
    if (typeof toolUseResult.is_error === "boolean") {
      lines.push(`Error: ${toolUseResult.is_error ? "yes" : "no"}`);
    }
  }

  const text = extractToolResultText(content).trim();
  if (text) {
    if (lines.length > 0) lines.push("");
    lines.push(truncate(text, 1200));
  }

  return lines.length > 0 ? lines : ["(empty result)"];
}

function formatSystemEvent(data: JsonRecord): string | null {
  const subtype = data.subtype;
  if (subtype === "init") {
    const model = asString(data.model) || "unknown model";
    const tools = Array.isArray(data.tools) ? data.tools.length : 0;
    const mcpServers = Array.isArray(data.mcp_servers)
      ? data.mcp_servers
          .map((server) => {
            if (!isRecord(server)) return null;
            const name = asString(server.name);
            const status = asString(server.status);
            return status ? `${name} (${status})` : name;
          })
          .filter(Boolean)
          .join(", ")
      : "";
    const mcpPart = mcpServers ? ` · MCP: ${mcpServers}` : "";
    return `[Session] ${model} · ${tools} tools${mcpPart}`;
  }
  if (subtype === "status" && data.status) {
    return `[Status] ${asString(data.status)}`;
  }
  return null;
}

type StreamFormatState = {
  seenBlocks: Map<string, string>;
  inReasoning: boolean;
  inAssistant: boolean;
  reasoningBuffer: string;
  assistantBuffer: string;
};

function formatStreamEvent(data: JsonRecord, state: StreamFormatState): void {
  const event = data.event;
  if (!isRecord(event) || event.type !== "content_block_delta") return;

  const index = asString(event.index);
  const delta = event.delta;
  if (!isRecord(delta)) return;

  const deltaType = delta.type;
  const streamKey = `stream:${index}:${deltaType}`;

  if (deltaType === "thinking_delta") {
    const chunk = asString(delta.thinking);
    if (!chunk) return;
    const previous = state.seenBlocks.get(streamKey) ?? "";
    state.seenBlocks.set(streamKey, previous + chunk);
    state.inReasoning = true;
    state.inAssistant = false;
    state.assistantBuffer = "";
    state.reasoningBuffer += chunk;
    return;
  }

  if (deltaType === "text_delta") {
    const chunk = asString(delta.text);
    if (!chunk) return;
    const previous = state.seenBlocks.get(streamKey) ?? "";
    state.seenBlocks.set(streamKey, previous + chunk);
    state.inReasoning = false;
    state.inAssistant = true;
    state.reasoningBuffer = "";
    state.assistantBuffer += chunk;
  }
}

function formatAssistantBlock(
  block: JsonRecord,
  blockKey: string,
  index: number,
  state: StreamFormatState,
): string | null {
  const blockType = block.type;
  if (blockType === "thinking") {
    const thinking = asString(block.thinking || block.text).trim();
    if (!thinking) return null;

    const streamKey = `stream:${index}:thinking_delta`;
    const streamed = state.seenBlocks.get(streamKey) ?? "";
    if (streamed === thinking) {
      state.seenBlocks.set(blockKey, thinking);
      return null;
    }

    const previous = state.seenBlocks.get(blockKey) ?? streamed;
    if (thinking === previous) return null;
    state.seenBlocks.set(blockKey, thinking);
    state.seenBlocks.set(streamKey, thinking);
    if (thinking.startsWith(previous) && previous.length > 0) {
      return thinking.slice(previous.length);
    }
    return thinking;
  }

  if (blockType === "text") {
    const text = asString(block.text).trim();
    if (!text) return null;

    const streamKey = `stream:${index}:text_delta`;
    const streamed = state.seenBlocks.get(streamKey) ?? "";
    if (streamed === text) {
      state.seenBlocks.set(blockKey, text);
      return null;
    }

    const previous = state.seenBlocks.get(blockKey) ?? streamed;
    if (text === previous) return null;
    state.seenBlocks.set(blockKey, text);
    state.seenBlocks.set(streamKey, text);
    if (text.startsWith(previous) && previous.length > 0) {
      return text.slice(previous.length);
    }
    return text;
  }

  if (blockType === "tool_use") {
    const name = asString(block.name) || "unknown";
    const input = isRecord(block.input) ? block.input : {};
    const serialized = JSON.stringify(input);
    const previous = state.seenBlocks.get(blockKey);
    if (previous === serialized) return null;
    state.seenBlocks.set(blockKey, serialized);
    state.inReasoning = false;
    state.inAssistant = false;
    const details = formatToolUse(name, input);
    const header = `--- Tool: ${name} ---`;
    return details.length > 0 ? `${header}\n${details.join("\n")}` : header;
  }

  return null;
}

function formatJsonLine(line: string, state: StreamFormatState): string | null {
  let data: JsonRecord;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return null;
    data = parsed;
  } catch {
    return null;
  }

  const eventType = data.type;

  if (eventType === "system") {
    if (data.subtype === "thinking_tokens") return "";
    return formatSystemEvent(data) ?? "";
  }

  if (eventType === "stream_event") {
    formatStreamEvent(data, state);
    return null;
  }

  if (eventType === "assistant") {
    const message = data.message;
    if (!isRecord(message)) return null;
    const messageId = asString(message.id) || "unknown";
    const parts: string[] = [];
    const content = message.content;
    if (!Array.isArray(content)) return null;

    content.forEach((block, index) => {
      if (!isRecord(block)) return;
      const blockKey = `${messageId}:${index}:${asString(block.type)}:${asString(block.id || block.name)}`;
      const formatted = formatAssistantBlock(block, blockKey, index, state);
      if (!formatted) return;

      if (block.type === "thinking") {
        if (!state.inReasoning) {
          parts.push("--- Reasoning ---");
          state.inReasoning = true;
          state.inAssistant = false;
        }
        parts.push(formatted);
      } else {
        if (state.inReasoning) {
          state.inReasoning = false;
          parts.push("");
        }
        if (block.type === "text") {
          if (!state.inAssistant) {
            parts.push("--- Assistant ---");
            state.inAssistant = true;
          }
          parts.push(formatted);
        } else {
          state.inAssistant = false;
          parts.push(formatted);
        }
      }
    });

    return parts.length > 0 ? parts.join("\n") : "";
  }

  if (eventType === "user") {
    const message = data.message;
    if (!isRecord(message)) return null;
    const content = message.content;
    if (!Array.isArray(content)) return null;

    const parts: string[] = [];
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      state.inReasoning = false;
      state.inAssistant = false;
      parts.push("--- Tool result ---");
      parts.push(...formatToolResult(block.content, data.tool_use_result));
    }
    return parts.length > 0 ? parts.join("\n") : "";
  }

  if (eventType === "result") {
    const result = data.result;
    if (typeof result === "string" && result.trim()) {
      return `--- Result ---\n${result.trim()}`;
    }
    if (isRecord(result)) {
      const errors = Array.isArray(result.errors) ? result.errors : [];
      if (errors.length > 0) {
        return `--- Result (errors) ---\n${errors.map(asString).join("\n")}`;
      }
    }
  }

  return "";
}

function flushStreamBuffers(output: string[], state: StreamFormatState) {
  if (state.reasoningBuffer) {
    output.push("--- Reasoning ---");
    output.push(state.reasoningBuffer);
    state.reasoningBuffer = "";
    state.inReasoning = false;
  }
  if (state.assistantBuffer) {
    output.push("--- Assistant ---");
    output.push(state.assistantBuffer);
    state.assistantBuffer = "";
    state.inAssistant = false;
  }
}

function formatStdoutSection(lines: string[]): string {
  const output: string[] = [];
  const state: StreamFormatState = {
    seenBlocks: new Map(),
    inReasoning: false,
    inAssistant: false,
    reasoningBuffer: "",
    assistantBuffer: "",
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushStreamBuffers(output, state);
      output.push("");
      continue;
    }

    let data: JsonRecord | null = null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) data = parsed;
    } catch {
      data = null;
    }

    if (data) {
      const formatted = formatJsonLine(trimmed, state);
      if (formatted) {
        flushStreamBuffers(output, state);
        output.push(formatted);
      }
      continue;
    }

    flushStreamBuffers(output, state);
    output.push(line);
  }

  flushStreamBuffers(output, state);
  return output.join("\n").trimEnd();
}

const SECTION_MARKERS = [
  "=== STDERR ===",
  "=== TRANSCRIPT (thinking + text) ===",
  "=== RUN END ===",
  "=== TIMEOUT ENFORCEMENT ===",
] as const;

function findNextSectionIndex(text: string, fromIndex: number): number {
  let next = -1;
  for (const marker of SECTION_MARKERS) {
    const index = text.indexOf(marker, fromIndex);
    if (index !== -1 && (next === -1 || index < next)) {
      next = index;
    }
  }
  return next;
}

export function formatRunLog(content: string): string {
  if (!content || content === "(empty)" || content === "Loading..." || content === "(could not load)") {
    return content;
  }

  const stdoutMarker = "=== STDOUT ===";
  const stdoutIndex = content.indexOf(stdoutMarker);
  if (stdoutIndex === -1) {
    return content;
  }

  const beforeStdout = content.slice(0, stdoutIndex + stdoutMarker.length);
  const afterStdoutStart = stdoutIndex + stdoutMarker.length;
  const nextSectionIndex = findNextSectionIndex(content, afterStdoutStart);
  const stdoutBody =
    nextSectionIndex === -1 ? content.slice(afterStdoutStart) : content.slice(afterStdoutStart, nextSectionIndex);
  const afterStdout = nextSectionIndex === -1 ? "" : content.slice(nextSectionIndex);

  const stdoutLines = stdoutBody.replace(/^\n/, "").split("\n");
  const formattedStdout = formatStdoutSection(stdoutLines);
  const hasFormattedEvents = formattedStdout.split("\n").some((line) => line.startsWith("---") || line.startsWith("["));

  let tail = afterStdout;
  if (hasFormattedEvents && tail.includes("=== TRANSCRIPT (thinking + text) ===")) {
    const transcriptStart = tail.indexOf("=== TRANSCRIPT (thinking + text) ===");
    const afterTranscript = findNextSectionIndex(tail, transcriptStart + 1);
    tail =
      afterTranscript === -1
        ? tail.slice(0, transcriptStart).trimEnd()
        : `${tail.slice(0, transcriptStart).trimEnd()}\n${tail.slice(afterTranscript)}`;
  }

  const formattedBody = formattedStdout.trimEnd();
  const sections = [beforeStdout.trimEnd()];
  if (formattedBody) {
    sections.push("", formattedBody);
  }
  if (tail.trim()) {
    sections.push("", tail.trim());
  }
  return sections.join("\n");
}
