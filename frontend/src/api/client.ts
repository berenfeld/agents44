import axios from "axios";

const API_URL = import.meta.env.REACT_APP_API_URL || "/api";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

export function apiErrorMessage(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return null;
  }
  const payload = (err as { response?: { data?: { error?: unknown } } }).response?.data?.error;
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const parts = Object.values(payload as Record<string, unknown>).flat();
    const text = parts.filter((value): value is string => typeof value === "string").join(", ");
    return text || null;
  }
  return null;
}

export const UNEXPECTED_SERVER_ERROR = "Unexpected server error";

export function userFacingApiError(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (typeof status === "number" && status >= 500) {
      return UNEXPECTED_SERVER_ERROR;
    }
  }
  return apiErrorMessage(err) || UNEXPECTED_SERVER_ERROR;
}

export type Department = {
  id: number;
  name: string;
  created_at: string | null;
  whatsapp_from_number: string | null;
  wati_configured: boolean;
  wati_webhook_url?: string;
  email_address: string | null;
  email_configured: boolean;
};

export type AgentActiveRun = {
  id: number;
  started_at: string | null;
  elapsed_seconds: number;
  timeout_seconds: number;
  timeout_sigterm_grace_seconds: number;
  timeout_sigkill_grace_seconds: number;
  timeout_sigterm_at_seconds: number;
  timeout_sigkill_at_seconds: number;
};

export type Agent = {
  id: number;
  name: string;
  department: string;
  model: string;
  crond: string | null;
  enabled: boolean;
  timeout_seconds: number;
  is_running: boolean;
  is_pending: boolean;
  active_run?: AgentActiveRun | null;
};

export type AgentWritePayload = {
  name: string;
  department: string;
  model: string;
  crond: string | null;
  enabled: boolean;
  timeout_seconds: number;
};

export function buildAgentWritePayload(values: AgentWritePayload): AgentWritePayload {
  return {
    name: values.name,
    department: values.department,
    model: values.model,
    crond: values.crond,
    enabled: values.enabled,
    timeout_seconds: values.timeout_seconds,
  };
}

export type AgentRun = {
  id: number;
  agent_id: number;
  agent_name?: string;
  status: string;
  trigger_source: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  estimated_cost_usd: number | null;
  started_at: string | null;
  finished_at: string | null;
  run_dir: string | null;
  prompt_path: string | null;
  log_path: string | null;
  summary_path: string | null;
  prompt_preview: string | null;
  error_message: string | null;
};

export type ModelsResponse = { models: string[]; default: string };

export type ClaudeMessage = {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  status: "pending" | "complete" | "failed";
  content: string;
  error_message: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  estimated_cost_usd: number | null;
  created_at: string | null;
  finished_at: string | null;
};

export type ClaudeConversation = {
  id: number;
  title: string;
  agent_id: number;
  agent_name: string | null;
  agent_model: string | null;
  agent_enabled: boolean;
  archived_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  busy: boolean;
  messages?: ClaudeMessage[];
};

export type WhatsAppMessage = {
  id: number;
  conversation_id: number;
  direction: "inbound" | "outbound";
  body: string;
  wati_message_id: string | null;
  created_at: string | null;
};

export type WhatsAppConversation = {
  id: number;
  agent_id: number;
  agent_name: string | null;
  department: string | null;
  from_number: string;
  to_number: string;
  created_at: string | null;
  updated_at: string | null;
  last_message_preview?: string | null;
  messages?: WhatsAppMessage[];
};

export type EmailSendingStatus = "pending" | "sent" | "fail" | "canceled";
export type EmailContentType = "html" | "plain";

export type EmailMessage = {
  id: number;
  agent_id: number;
  agent_name: string | null;
  department: string | null;
  from_email: string;
  subject: string;
  recipients: string[];
  cc: string[];
  bcc: string[];
  message: string;
  content_type: EmailContentType;
  sending_status: EmailSendingStatus;
  created_at: string | null;
  updated_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  attempt_count: number;
  error_message: string | null;
};

export type EmailWritePayload = {
  from_email?: string;
  subject?: string;
  recipients?: string[];
  cc?: string[];
  bcc?: string[];
  message?: string;
  content_type?: EmailContentType;
  sending_status?: EmailSendingStatus;
};

export type SystemParam = {
  id: number;
  key: string;
  value: string;
  description: string | null;
};

export type AgentDbMeta = {
  version: string;
  table_count: number;
  total_size_bytes: number;
};

export type AgentDbTable = {
  schema: string;
  name: string;
  qualified_name: string;
  row_count: number;
};

export type AgentDbColumn = {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
  autoincrement: boolean;
  default: unknown;
};

export type AgentDbSchema = {
  schema: string;
  name: string;
  qualified_name: string;
  columns: AgentDbColumn[];
  primary_keys: string[];
  foreign_keys: Array<{
    columns: string[];
    referred_table: string | null;
    referred_columns: string[];
  }>;
};

export type AgentDbRow = Record<string, unknown>;

export type AgentDbFilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "ilike"
  | "like"
  | "is_null"
  | "is_not_null";

export type AgentDbRowsQuery = {
  limit?: number;
  offset?: number;
  sort_by?: string | null;
  sort_dir?: "asc" | "desc" | null;
  filter_column?: string | null;
  filter_op?: AgentDbFilterOp | null;
  filter_value?: string | null;
};

export type AgentDbRowsResponse = {
  items: AgentDbRow[];
  total: number;
  limit: number;
  offset: number;
  sort?: { column: string; direction: "asc" | "desc" };
  filter?: { column: string; op: AgentDbFilterOp; value: string | null };
};
