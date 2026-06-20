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

export type AgentDbTable = {
  name: string;
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
  name: string;
  columns: AgentDbColumn[];
  primary_keys: string[];
  foreign_keys: Array<{
    columns: string[];
    referred_table: string | null;
    referred_columns: string[];
  }>;
};

export type AgentDbRow = Record<string, unknown>;
