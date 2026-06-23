import axios from "axios";

const API_URL = import.meta.env.REACT_APP_API_URL || "/api";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

export type Department = {
  id: number;
  name: string;
  created_at: string | null;
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
