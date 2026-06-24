import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DataGrid, { SelectColumn, type Column, type RowsChangeData } from "react-data-grid";
import {
  AgentDbColumn,
  AgentDbFilterOp,
  AgentDbMeta,
  AgentDbRow,
  AgentDbRowsQuery,
  AgentDbSchema,
  AgentDbTable,
  api,
} from "@/api/client";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { Button, Input } from "@/components/ui/primitives";
import {
  DataCard,
  DataCardField,
  DataCardTitle,
  MobileCardList,
} from "@/components/ui/data-card";
import { PanelCard, SplitPanelLayout } from "@/components/ui/split-panel-layout";
import { ColumnProjectionMenu } from "@/components/ui/column-projection-menu";
import { cn } from "@/lib/utils";
import "react-data-grid/lib/styles.css";

type GridRow = AgentDbRow & {
  _rowId: string;
  _isNew?: boolean;
};

type SortDirection = "asc" | "desc";

type RowQueryState = {
  limit: number;
  offset: number;
  sortBy: string | null;
  sortDir: SortDirection;
  filterColumn: string;
  filterOp: AgentDbFilterOp | "";
  filterValue: string;
};

const ROW_LIMIT_OPTIONS = [50, 100, 200, 500, 1000, 2000] as const;
const DEFAULT_ROW_LIMIT = 100;
const GRID_ROW_HEIGHT = 35;
const COLUMN_VISIBILITY_PREFIX = "agent-db-columns:";
const SCHEMA_COLLAPSE_KEY = "agent-db-schema-collapsed";
const ALLOWED_FILTER_OPS = new Set<string>([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "ilike",
  "like",
  "is_null",
  "is_not_null",
]);

const FILTER_OP_LABELS: Record<AgentDbFilterOp, string> = {
  eq: "==",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  ilike: "ILIKE",
  like: "LIKE",
  is_null: "IS NULL",
  is_not_null: "IS NOT NULL",
};

const NULL_FILTER_OPS = new Set<AgentDbFilterOp>(["is_null", "is_not_null"]);

function formatDataSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function defaultQueryState(): RowQueryState {
  return {
    limit: DEFAULT_ROW_LIMIT,
    offset: 0,
    sortBy: null,
    sortDir: "asc",
    filterColumn: "",
    filterOp: "",
    filterValue: "",
  };
}

type AgentDbPageState = {
  table: string | null;
  query: RowQueryState;
  sidebarCollapsed: boolean;
};

function parseAgentDbSearchParams(searchParams: URLSearchParams): AgentDbPageState {
  const query = defaultQueryState();

  const limitRaw = searchParams.get("limit");
  if (limitRaw) {
    const limit = Number(limitRaw);
    if (ROW_LIMIT_OPTIONS.includes(limit as (typeof ROW_LIMIT_OPTIONS)[number])) {
      query.limit = limit;
    }
  }

  const offsetRaw = searchParams.get("offset");
  if (offsetRaw !== null) {
    const offset = Number(offsetRaw);
    if (!Number.isNaN(offset) && offset >= 0) {
      query.offset = offset;
    }
  }

  const sortBy = searchParams.get("sort_by");
  if (sortBy) {
    query.sortBy = sortBy;
    query.sortDir = searchParams.get("sort_dir") === "desc" ? "desc" : "asc";
  }

  const filterColumn = searchParams.get("filter_column") ?? "";
  const filterOp = searchParams.get("filter_op") ?? "";
  if (filterColumn && filterOp && ALLOWED_FILTER_OPS.has(filterOp)) {
    query.filterColumn = filterColumn;
    query.filterOp = filterOp as AgentDbFilterOp;
    query.filterValue = searchParams.get("filter_value") ?? "";
  }

  return {
    table: searchParams.get("table"),
    query,
    sidebarCollapsed: searchParams.get("sidebar") === "collapsed",
  };
}

function buildAgentDbSearchParams({ table, query, sidebarCollapsed }: AgentDbPageState): URLSearchParams {
  const params = new URLSearchParams();
  if (table) {
    params.set("table", table);
  }
  if (query.limit !== DEFAULT_ROW_LIMIT) {
    params.set("limit", String(query.limit));
  }
  if (query.offset > 0) {
    params.set("offset", String(query.offset));
  }
  if (query.sortBy) {
    params.set("sort_by", query.sortBy);
    if (query.sortDir === "desc") {
      params.set("sort_dir", "desc");
    }
  }
  if (query.filterColumn && query.filterOp) {
    params.set("filter_column", query.filterColumn);
    params.set("filter_op", query.filterOp);
    if (!NULL_FILTER_OPS.has(query.filterOp) && query.filterValue !== "") {
      params.set("filter_value", query.filterValue);
    }
  }
  if (sidebarCollapsed) {
    params.set("sidebar", "collapsed");
  }
  return params;
}

function filterOpsForType(columnType: string): AgentDbFilterOp[] {
  if (columnType === "boolean") {
    return ["eq", "ne", "is_null", "is_not_null"];
  }
  if (columnType === "integer" || columnType === "number" || columnType === "date" || columnType === "datetime") {
    return ["eq", "ne", "gt", "gte", "lt", "lte", "is_null", "is_not_null"];
  }
  return ["eq", "ne", "ilike", "like", "is_null", "is_not_null"];
}

function rowKey(row: GridRow) {
  return row._rowId;
}

function primaryKeys(schema: AgentDbSchema, row: AgentDbRow) {
  return Object.fromEntries(schema.primary_keys.map((key) => [key, row[key]]));
}

function stripInternal(row: GridRow): AgentDbRow {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "_rowId" && key !== "_isNew"),
  );
}

function toGridRows(items: AgentDbRow[], schema: AgentDbSchema): GridRow[] {
  return items.map((item) => ({
    ...item,
    _rowId: schema.primary_keys.length
      ? schema.primary_keys.map((key) => String(item[key] ?? "")).join("|")
      : crypto.randomUUID(),
  }));
}

function formatCell(value: unknown) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function buildRowQueryParams(query: RowQueryState): AgentDbRowsQuery {
  const params: AgentDbRowsQuery = {
    limit: query.limit,
    offset: query.offset,
  };
  if (query.sortBy) {
    params.sort_by = query.sortBy;
    params.sort_dir = query.sortDir;
  }
  if (query.filterColumn && query.filterOp) {
    params.filter_column = query.filterColumn;
    params.filter_op = query.filterOp;
    if (!NULL_FILTER_OPS.has(query.filterOp)) {
      params.filter_value = query.filterValue;
    }
  }
  return params;
}

function buildColumns(
  schema: AgentDbSchema,
  sortBy: string | null,
  sortDir: SortDirection,
  onSort: (column: string) => void,
  visibleColumns: ReadonlySet<string>,
): Column<GridRow>[] {
  const dataColumns = schema.columns
    .filter((col) => visibleColumns.has(col.name))
    .map((col: AgentDbColumn) => {
    const editable = !(col.primary_key && col.autoincrement);
    const active = sortBy === col.name;
    return {
      key: col.name,
      name: col.primary_key ? `${col.name} (PK)` : col.name,
      editable,
      resizable: true,
      minWidth: 120,
      renderHeaderCell: () => (
        <button
          type="button"
          onClick={() => onSort(col.name)}
          className={`inline-flex w-full items-center gap-1 px-2 py-1 text-left font-medium hover:text-slate-900 ${
            active ? "text-slate-900" : "text-slate-700"
          }`}
        >
          <span className="truncate">{col.primary_key ? `${col.name} (PK)` : col.name}</span>
          <span className="shrink-0 text-xs text-slate-400" aria-hidden>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      ),
      renderCell: ({ row }: { row: GridRow }) => <span className="truncate">{formatCell(row[col.name])}</span>,
    } satisfies Column<GridRow>;
  });
  return [SelectColumn, ...dataColumns];
}

function tableApiPath(qualifiedName: string) {
  return `/agent-db/tables/${encodeURIComponent(qualifiedName)}`;
}

function selectClassName(className?: string) {
  return cn(
    "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 md:h-8 md:w-auto md:px-2",
    className,
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

function RefreshIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
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

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("h-4 w-4", className)} aria-hidden="true">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

function readVisibleColumns(tableName: string, columnNames: string[]): Set<string> {
  try {
    const raw = localStorage.getItem(`${COLUMN_VISIBILITY_PREFIX}${tableName}`);
    if (!raw) {
      return new Set(columnNames);
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set(columnNames);
    }
    const allowed = new Set(columnNames);
    const saved = parsed.filter((name): name is string => typeof name === "string" && allowed.has(name));
    return saved.length > 0 ? new Set(saved) : new Set(columnNames);
  } catch {
    return new Set(columnNames);
  }
}

function writeVisibleColumns(tableName: string, visibleColumns: ReadonlySet<string>) {
  try {
    localStorage.setItem(
      `${COLUMN_VISIBILITY_PREFIX}${tableName}`,
      JSON.stringify([...visibleColumns]),
    );
  } catch {
    // ignore storage errors
  }
}

function migrateVisibleColumns(oldName: string, newName: string) {
  try {
    const key = `${COLUMN_VISIBILITY_PREFIX}${oldName}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      localStorage.setItem(`${COLUMN_VISIBILITY_PREFIX}${newName}`, raw);
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}

function readCollapsedSchemas(): Set<string> {
  try {
    const raw = localStorage.getItem(SCHEMA_COLLAPSE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((name): name is string => typeof name === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsedSchemas(collapsedSchemas: ReadonlySet<string>) {
  try {
    localStorage.setItem(SCHEMA_COLLAPSE_KEY, JSON.stringify([...collapsedSchemas]));
  } catch {
    // ignore storage errors
  }
}

function ToolbarDivider({ className }: { className?: string }) {
  return <span className={cn("mx-0.5 h-5 w-px shrink-0 bg-slate-200", className)} aria-hidden="true" />;
}

export default function AgentDatabasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { table: selectedTable, query, sidebarCollapsed } = useMemo(
    () => parseAgentDbSearchParams(searchParams),
    [searchParams],
  );

  const [dbMeta, setDbMeta] = useState<AgentDbMeta | null>(null);
  const [tables, setTables] = useState<AgentDbTable[]>([]);
  const [schema, setSchema] = useState<AgentDbSchema | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tableToDrop, setTableToDrop] = useState<AgentDbTable | null>(null);
  const [tableToRename, setTableToRename] = useState<AgentDbTable | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [draftFilter, setDraftFilter] = useState({
    filterColumn: query.filterColumn,
    filterOp: query.filterOp,
    filterValue: query.filterValue,
  });
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set());
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(() => readCollapsedSchemas());
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const setTableAndQuery = useCallback(
    (table: string | null, nextQuery: RowQueryState, options?: { replace?: boolean }) => {
      setSearchParams(
        buildAgentDbSearchParams({ table, query: nextQuery, sidebarCollapsed }),
        { replace: options?.replace ?? true },
      );
    },
    [setSearchParams, sidebarCollapsed],
  );

  const patchQuery = useCallback(
    (patch: Partial<RowQueryState>) => {
      setTableAndQuery(selectedTable, { ...query, ...patch });
    },
    [query, selectedTable, setTableAndQuery],
  );

  const loadTables = useCallback(async () => {
    const [tablesRes, metaRes] = await Promise.all([
      api.get<AgentDbTable[]>("/agent-db/tables"),
      api.get<AgentDbMeta>("/agent-db/meta"),
    ]);
    setTables(tablesRes.data);
    setDbMeta(metaRes.data);
  }, []);

  const tablesBySchema = useMemo(() => {
    const grouped = new Map<string, AgentDbTable[]>();
    for (const table of tables) {
      const items = grouped.get(table.schema) ?? [];
      items.push(table);
      grouped.set(table.schema, items);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tables]);

  const loadTableData = useCallback(async (tableName: string, rowQuery: RowQueryState) => {
    setLoading(true);
    setError(null);
    try {
      const params = buildRowQueryParams(rowQuery);
      const [schemaRes, rowsRes] = await Promise.all([
        api.get<AgentDbSchema>(`${tableApiPath(tableName)}/schema`),
        api.get<{ items: AgentDbRow[]; total: number; limit: number; offset: number }>(
          `${tableApiPath(tableName)}/rows`,
          { params },
        ),
      ]);
      setSchema(schemaRes.data);
      setRows(toGridRows(rowsRes.data.items, schemaRes.data));
      setTotal(rowsRes.data.total);
      setSelectedRows(new Set());
    } catch (err) {
      setError(axiosErrorMessage(err) ?? "Failed to load table");
      setSchema(null);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTables().catch(console.error);
  }, [loadTables]);

  useEffect(() => {
    if (tables.length === 0) {
      return;
    }
    const { table: urlTable, query: urlQuery } = parseAgentDbSearchParams(searchParams);
    if (!urlTable) {
      setTableAndQuery(tables[0].qualified_name, urlQuery, { replace: true });
      return;
    }
    if (!tables.some((table) => table.qualified_name === urlTable)) {
      setTableAndQuery(tables[0].qualified_name, urlQuery, { replace: true });
    }
  }, [tables, searchParams, setTableAndQuery]);

  useEffect(() => {
    setDraftFilter({
      filterColumn: query.filterColumn,
      filterOp: query.filterOp,
      filterValue: query.filterValue,
    });
  }, [query.filterColumn, query.filterOp, query.filterValue]);

  useEffect(() => {
    if (selectedTable) {
      loadTableData(selectedTable, query).catch(console.error);
    }
  }, [selectedTable, query, loadTableData]);

  useEffect(() => {
    if (!schema || !selectedTable || schema.qualified_name !== selectedTable) {
      return;
    }
    const columnNames = schema.columns.map((col) => col.name);
    setVisibleColumns(readVisibleColumns(selectedTable, columnNames));
  }, [schema, selectedTable]);

  const handleVisibleColumnsChange = useCallback(
    (next: Set<string>) => {
      setVisibleColumns(next);
      if (selectedTable) {
        writeVisibleColumns(selectedTable, next);
      }
    },
    [selectedTable],
  );

  const toggleSidebar = useCallback(() => {
    setSearchParams(
      buildAgentDbSearchParams({
        table: selectedTable,
        query,
        sidebarCollapsed: !sidebarCollapsed,
      }),
      { replace: true },
    );
  }, [query, selectedTable, setSearchParams, sidebarCollapsed]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const handleSort = useCallback(
    (column: string) => {
      if (query.sortBy === column) {
        patchQuery({ sortDir: query.sortDir === "asc" ? "desc" : "asc", offset: 0 });
        return;
      }
      patchQuery({ sortBy: column, sortDir: "asc", offset: 0 });
    },
    [patchQuery, query.sortBy, query.sortDir],
  );

  const columns = useMemo(
    () =>
      schema
        ? buildColumns(schema, query.sortBy, query.sortDir, handleSort, visibleColumns)
        : [],
    [schema, query.sortBy, query.sortDir, handleSort, visibleColumns],
  );

  const projectionColumns = useMemo(
    () =>
      schema?.columns.map((col) => ({
        name: col.name,
        label: col.primary_key ? `${col.name} (PK)` : col.name,
        type: col.type,
        primaryKey: col.primary_key,
      })) ?? [],
    [schema],
  );

  const displayedSchemaColumns = useMemo(
    () => schema?.columns.filter((col) => visibleColumns.has(col.name)) ?? [],
    [schema, visibleColumns],
  );

  const gridBlockSize = useMemo(
    () => Math.max(GRID_ROW_HEIGHT * 2, (rows.length + 1) * GRID_ROW_HEIGHT),
    [rows.length],
  );

  const selectedFilterColumn = useMemo(
    () => schema?.columns.find((col) => col.name === draftFilter.filterColumn) ?? null,
    [schema, draftFilter.filterColumn],
  );

  const availableFilterOps = useMemo(
    () => (selectedFilterColumn ? filterOpsForType(selectedFilterColumn.type) : []),
    [selectedFilterColumn],
  );

  const applyFilter = () => {
    if (!draftFilter.filterColumn || !draftFilter.filterOp) {
      clearFilter();
      return;
    }
    if (
      !NULL_FILTER_OPS.has(draftFilter.filterOp) &&
      draftFilter.filterValue.trim() === ""
    ) {
      setError("Filter value is required");
      return;
    }
    setError(null);
    patchQuery({
      offset: 0,
      filterColumn: draftFilter.filterColumn,
      filterOp: draftFilter.filterOp,
      filterValue: draftFilter.filterValue,
    });
  };

  const clearFilter = () => {
    setDraftFilter({ filterColumn: "", filterOp: "", filterValue: "" });
    patchQuery({
      offset: 0,
      filterColumn: "",
      filterOp: "",
      filterValue: "",
    });
  };

  const scheduleSave = useCallback(
    (row: GridRow) => {
      if (!schema || !selectedTable) return;
      const existing = saveTimers.current.get(row._rowId);
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        row._rowId,
        setTimeout(async () => {
          saveTimers.current.delete(row._rowId);
          setBusy(true);
          setError(null);
          try {
            const payload = stripInternal(row);
            if (row._isNew) {
              const res = await api.post<AgentDbRow>(`${tableApiPath(selectedTable)}/rows`, {
                values: payload,
              });
              setRows((current) =>
                current.map((item) =>
                  item._rowId === row._rowId
                    ? {
                        ...res.data,
                        _rowId: schema.primary_keys.length
                          ? schema.primary_keys.map((key) => String(res.data[key] ?? "")).join("|")
                          : item._rowId,
                      }
                    : item,
                ),
              );
              await loadTables();
              setTotal((value) => value + 1);
            } else {
              const res = await api.put<AgentDbRow>(`${tableApiPath(selectedTable)}/rows`, {
                keys: primaryKeys(schema, row),
                values: payload,
              });
              setRows((current) =>
                current.map((item) =>
                  item._rowId === row._rowId ? { ...res.data, _rowId: item._rowId } : item,
                ),
              );
            }
          } catch (err) {
            const message =
              axiosErrorMessage(err) ?? (row._isNew ? "Failed to create row" : "Failed to update row");
            setError(message);
          } finally {
            setBusy(false);
          }
        }, 400),
      );
    },
    [loadTables, schema, selectedTable],
  );

  const handleRowsChange = (newRows: GridRow[], data: RowsChangeData<GridRow>) => {
    setRows(newRows);
    for (const index of data.indexes) {
      scheduleSave(newRows[index]);
    }
  };

  const deleteSelected = async () => {
    if (!schema || !selectedTable) return;
    setBusy(true);
    setError(null);
    try {
      const targets = rows.filter((row) => selectedRows.has(row._rowId) && !row._isNew);
      for (const row of targets) {
        await api.delete(`${tableApiPath(selectedTable)}/rows`, {
          data: { keys: primaryKeys(schema, row) },
        });
      }
      setRows((current) => current.filter((row) => !selectedRows.has(row._rowId)));
      setSelectedRows(new Set());
      setTotal((value) => Math.max(0, value - targets.length));
      await loadTables();
    } catch (err) {
      setError(axiosErrorMessage(err) ?? "Failed to delete rows");
    } finally {
      setBusy(false);
      setDeleteOpen(false);
    }
  };

  const dropTable = async () => {
    if (!tableToDrop) return;
    const droppedName = tableToDrop.qualified_name;
    setBusy(true);
    setError(null);
    try {
      await api.delete(tableApiPath(droppedName));
      const remaining = tables.filter((table) => table.qualified_name !== droppedName);
      await loadTables();
      if (selectedTable === droppedName) {
        setTableAndQuery(remaining[0]?.qualified_name ?? null, defaultQueryState());
      }
      setTableToDrop(null);
    } catch (err) {
      setError(axiosErrorMessage(err) ?? "Failed to drop table");
    } finally {
      setBusy(false);
    }
  };

  const renameTable = async () => {
    if (!tableToRename) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ qualified_name: string; name: string }>(
        tableApiPath(tableToRename.qualified_name),
        { name: trimmed },
      );
      migrateVisibleColumns(tableToRename.qualified_name, res.data.qualified_name);
      await loadTables();
      if (selectedTable === tableToRename.qualified_name) {
        setTableAndQuery(res.data.qualified_name, query);
      }
      setTableToRename(null);
      setRenameDraft("");
    } catch (err) {
      setError(axiosErrorMessage(err) ?? "Failed to rename table");
    } finally {
      setBusy(false);
    }
  };

  const openRenameTable = (table: AgentDbTable) => {
    setTableToRename(table);
    setRenameDraft(table.name);
  };

  const deleteCount = rows.filter((row) => selectedRows.has(row._rowId) && !row._isNew).length;
  const rangeStart = total === 0 ? 0 : query.offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(query.offset + rows.length, total);
  const canGoPrev = query.offset > 0;
  const canGoNext = query.offset + query.limit < total;

  const updateRowField = (rowId: string, columnName: string, value: unknown) => {
    const index = rows.findIndex((row) => row._rowId === rowId);
    if (index === -1) return;
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [columnName]: value };
    setRows(newRows);
    scheduleSave(newRows[index]);
  };

  const toggleRowSelection = (rowId: string) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const toggleSchemaCollapsed = (schemaName: string) => {
    setCollapsedSchemas((current) => {
      const next = new Set(current);
      if (next.has(schemaName)) {
        next.delete(schemaName);
      } else {
        next.add(schemaName);
      }
      writeCollapsedSchemas(next);
      return next;
    });
  };

  const tablePickerOptions = useMemo(
    () =>
      tablesBySchema.flatMap(([schemaName, schemaTables]) =>
        schemaTables.map((table) => ({
          value: table.qualified_name,
          label: `${schemaName}.${table.name} (${table.row_count})`,
        })),
      ),
    [tablesBySchema],
  );

  const rowCardTitle = (row: GridRow) => {
    if (!schema || schema.primary_keys.length === 0) {
      return row._isNew ? "New row" : "Row";
    }
    return schema.primary_keys.map((key) => formatCell(row[key])).join(" · ");
  };

  const renderTableSidebar = (className?: string) => (
    <PanelCard className={cn("p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Tables</h2>
        <button
          type="button"
          onClick={toggleSidebar}
          title="Collapse tables panel"
          aria-label="Collapse tables panel"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <PanelLeftCloseIcon />
        </button>
      </div>
      <div className="space-y-3">
        {tablesBySchema.map(([schemaName, schemaTables]) => {
          const isExpanded = !collapsedSchemas.has(schemaName);
          return (
          <div key={schemaName}>
            <button
              type="button"
              onClick={() => toggleSchemaCollapsed(schemaName)}
              aria-expanded={isExpanded}
              className="mb-1 flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <ChevronDownIcon open={isExpanded} />
              <span className="min-w-0 truncate">{schemaName}</span>
              <span className="ml-auto shrink-0 text-[10px] font-normal normal-case text-slate-400">
                {schemaTables.length}
              </span>
            </button>
            {isExpanded ? (
            <ul className="space-y-1">
              {schemaTables.map((table) => {
                const isSelected = selectedTable === table.qualified_name;
                return (
                  <li key={table.qualified_name}>
                    <div
                      className={cn(
                        "flex items-center gap-0.5 rounded-md",
                        isSelected ? "bg-slate-900" : "hover:bg-slate-100",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setTableAndQuery(table.qualified_name, defaultQueryState())}
                        className={cn(
                          "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm",
                          isSelected ? "text-white" : "text-slate-700",
                        )}
                      >
                        <span className="font-medium">{table.name}</span>
                        <span className={cn("ml-1 text-xs", isSelected ? "text-slate-300" : "text-slate-500")}>
                          ({table.row_count})
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5 pr-1">
                        <button
                          type="button"
                          title={`Rename ${table.qualified_name}`}
                          aria-label={`Rename ${table.qualified_name}`}
                          disabled={busy}
                          onClick={() => openRenameTable(table)}
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded disabled:opacity-40",
                            isSelected
                              ? "text-slate-300 hover:bg-slate-800 hover:text-white"
                              : "text-slate-400 hover:bg-slate-200 hover:text-slate-700",
                          )}
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title={`Drop ${table.qualified_name}`}
                          aria-label={`Drop ${table.qualified_name}`}
                          disabled={busy}
                          onClick={() => setTableToDrop(table)}
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded disabled:opacity-40",
                            isSelected
                              ? "text-slate-300 hover:bg-red-900/60 hover:text-red-200"
                              : "text-slate-400 hover:bg-red-50 hover:text-red-600",
                          )}
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            ) : null}
          </div>
        );
        })}
        {tables.length === 0 ? <p className="text-sm text-slate-500">No tables yet</p> : null}
      </div>
    </PanelCard>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h1 className="text-2xl font-semibold">Agent Database</h1>
        {dbMeta ? (
          <p className="text-xs text-slate-500">
            PostgreSQL {dbMeta.version} · {dbMeta.table_count} {dbMeta.table_count === 1 ? "table" : "tables"} ·{" "}
            {formatDataSize(dbMeta.total_size_bytes)}
          </p>
        ) : null}
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <SplitPanelLayout sidebarClassName={sidebarCollapsed ? "md:hidden" : undefined} sidebar={
          <>
            <div className="md:hidden">
              <label htmlFor="table-picker" className="mb-1 block text-sm font-medium text-slate-700">
                Table
              </label>
              <select
                id="table-picker"
                value={selectedTable ?? ""}
                onChange={(event) => setTableAndQuery(event.target.value, defaultQueryState())}
                className={selectClassName()}
                disabled={tables.length === 0}
              >
                {tablePickerOptions.length === 0 ? (
                  <option value="">No tables yet</option>
                ) : (
                  tablePickerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </div>
            {!sidebarCollapsed ? renderTableSidebar("hidden md:block") : null}
          </>
        }
      >
          <div className="flex flex-col gap-2 rounded-lg border bg-white px-2 py-1.5 md:flex-row md:flex-nowrap md:items-center md:gap-1.5 md:overflow-x-auto">
            <div className="flex flex-wrap items-center gap-1.5 md:contents">
              {sidebarCollapsed ? (
                <ToolbarIconButton
                  title="Expand tables panel"
                  variant="outline"
                  onClick={toggleSidebar}
                  className="hidden md:inline-flex"
                >
                  <PanelLeftIcon />
                </ToolbarIconButton>
              ) : null}
              <ToolbarIconButton
                title="Refresh"
                variant="outline"
                onClick={() => selectedTable && loadTableData(selectedTable, query)}
                disabled={!selectedTable || loading || busy}
              >
                <RefreshIcon />
              </ToolbarIconButton>
              <ToolbarIconButton
                title={`Delete selected (${deleteCount})`}
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteCount === 0 || busy}
              >
                <TrashIcon />
              </ToolbarIconButton>

              {schema ? (
                <>
                  <ToolbarDivider className="hidden md:block" />
                  <ColumnProjectionMenu
                    columns={projectionColumns}
                    visibleColumns={visibleColumns}
                    onVisibleColumnsChange={handleVisibleColumnsChange}
                    disabled={loading || busy}
                  />
                </>
              ) : null}
            </div>

            {schema ? (
              <div className="flex flex-wrap items-center gap-1.5 md:contents">
                <ToolbarDivider className="hidden md:block" />
                <span className="shrink-0 text-xs font-medium text-slate-500">Filter</span>
                <select
                  id="filter-column"
                  aria-label="Filter column"
                  value={draftFilter.filterColumn}
                  onChange={(event) => {
                    const filterColumn = event.target.value;
                    const column = schema.columns.find((item) => item.name === filterColumn);
                    const ops = column ? filterOpsForType(column.type) : [];
                    setDraftFilter((current) => ({
                      ...current,
                      filterColumn,
                      filterOp: ops.includes(current.filterOp as AgentDbFilterOp) ? current.filterOp : ops[0] ?? "",
                    }));
                  }}
                  className={selectClassName("w-28 shrink-0")}
                >
                  <option value="">Column</option>
                  {schema.columns.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name}
                    </option>
                  ))}
                </select>
                <select
                  id="filter-op"
                  aria-label="Filter operator"
                  value={draftFilter.filterOp}
                  onChange={(event) =>
                    setDraftFilter((current) => ({
                      ...current,
                      filterOp: event.target.value as AgentDbFilterOp | "",
                    }))
                  }
                  disabled={!draftFilter.filterColumn}
                  className={selectClassName("w-20 shrink-0")}
                >
                  <option value="">Op</option>
                  {availableFilterOps.map((op) => (
                    <option key={op} value={op}>
                      {FILTER_OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <Input
                  id="filter-value"
                  aria-label="Filter value"
                  value={draftFilter.filterValue}
                  onChange={(event) =>
                    setDraftFilter((current) => ({ ...current, filterValue: event.target.value }))
                  }
                  disabled={
                    !draftFilter.filterColumn ||
                    !draftFilter.filterOp ||
                    NULL_FILTER_OPS.has(draftFilter.filterOp as AgentDbFilterOp)
                  }
                  placeholder="Value"
                  className="h-8 w-24 shrink-0 px-2 text-sm"
                />
                <ToolbarIconButton title="Apply filter" onClick={applyFilter} disabled={!schema || loading}>
                  <CheckIcon />
                </ToolbarIconButton>
                {query.filterColumn && query.filterOp ? (
                  <ToolbarIconButton title="Clear filter" variant="outline" onClick={clearFilter}>
                    <XIcon />
                  </ToolbarIconButton>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 md:contents">
              <ToolbarDivider className="hidden md:block" />
              <select
                id="row-limit"
                aria-label="Rows per page"
                value={query.limit}
                onChange={(event) =>
                  patchQuery({
                    limit: Number(event.target.value),
                    offset: 0,
                  })
                }
                disabled={!selectedTable || loading}
                className={selectClassName("w-16 shrink-0")}
              >
                {ROW_LIMIT_OPTIONS.map((limit) => (
                  <option key={limit} value={limit}>
                    {limit}
                  </option>
                ))}
              </select>
              <ToolbarIconButton
                title="Previous page"
                variant="outline"
                onClick={() => patchQuery({ offset: Math.max(0, query.offset - query.limit) })}
                disabled={!canGoPrev || loading}
              >
                <ChevronLeftIcon />
              </ToolbarIconButton>
              <ToolbarIconButton
                title="Next page"
                variant="outline"
                onClick={() => patchQuery({ offset: query.offset + query.limit })}
                disabled={!canGoNext || loading}
              >
                <ChevronRightIcon />
              </ToolbarIconButton>

              <span className="min-w-0 basis-full text-xs leading-relaxed text-slate-500 md:ml-auto md:basis-auto md:shrink-0 md:truncate">
                {busy ? "Saving… · " : ""}
                {selectedTable ? (
                  <>
                    {selectedTable} · {rangeStart}–{rangeEnd}/{total}
                    {query.filterColumn && query.filterOp ? (
                      <>
                        {" "}
                        · {query.filterColumn} {FILTER_OP_LABELS[query.filterOp as AgentDbFilterOp]}
                        {!NULL_FILTER_OPS.has(query.filterOp as AgentDbFilterOp) ? ` "${query.filterValue}"` : ""}
                      </>
                    ) : null}
                  </>
                ) : (
                  "Select a table"
                )}
              </span>
            </div>
          </div>

          <div className="hidden rounded-lg border bg-white md:block">
            {loading ? (
              <div className="p-8 text-sm text-slate-500">Loading…</div>
            ) : schema && selectedTable ? (
              visibleColumns.size === 0 ? (
                <div className="p-8 text-sm text-slate-500">
                  No columns selected. Use the Columns menu to choose fields to display.
                </div>
              ) : (
              <DataGrid
                className="rdg-light w-full text-sm"
                style={{ blockSize: gridBlockSize }}
                rowHeight={GRID_ROW_HEIGHT}
                columns={columns}
                rows={rows}
                rowKeyGetter={rowKey}
                selectedRows={selectedRows}
                onSelectedRowsChange={setSelectedRows}
                onRowsChange={handleRowsChange}
              />
              )
            ) : (
              <div className="p-8 text-sm text-slate-500">Select a table</div>
            )}
          </div>

          <MobileCardList>
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : schema && selectedTable ? (
              rows.map((row) => (
                <DataCard key={row._rowId} className={selectedRows.has(row._rowId) ? "ring-2 ring-slate-400" : undefined}>
                  <div className="mb-2 flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                      checked={selectedRows.has(row._rowId)}
                      onChange={() => toggleRowSelection(row._rowId)}
                      aria-label={`Select row ${rowCardTitle(row)}`}
                    />
                    <DataCardTitle>{rowCardTitle(row)}</DataCardTitle>
                  </div>
                  <dl>
                    {displayedSchemaColumns.map((col) => {
                      const editable = !(col.primary_key && col.autoincrement);
                      const value = row[col.name];
                      const label = col.primary_key ? `${col.name} (PK)` : col.name;
                      return (
                        <DataCardField key={col.name} label={label}>
                          {editable ? (
                            col.type === "boolean" ? (
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300"
                                checked={Boolean(value)}
                                onChange={(event) => updateRowField(row._rowId, col.name, event.target.checked)}
                              />
                            ) : (
                              <Input
                                value={formatCell(value)}
                                className="h-8 px-2 text-sm"
                                onChange={(event) => updateRowField(row._rowId, col.name, event.target.value)}
                              />
                            )
                          ) : (
                            formatCell(value)
                          )}
                        </DataCardField>
                      );
                    })}
                  </dl>
                </DataCard>
              ))
            ) : (
              <p className="text-sm text-slate-500">Select a table</p>
            )}
          </MobileCardList>

          {schema ? (
            <p className="text-xs text-slate-500">
              Primary keys: {schema.primary_keys.join(", ") || "(none)"}. Double-click a cell to edit on desktop; on
              mobile, edit fields directly in each card.
            </p>
          ) : null}
      </SplitPanelLayout>

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete selected rows?"
        confirmLabel="Delete"
        destructive
        description={
          <p>
            Permanently delete {deleteCount} row{deleteCount === 1 ? "" : "s"} from <strong>{selectedTable}</strong>?
          </p>
        }
        onConfirm={() => {
          deleteSelected().catch(console.error);
        }}
      />

      <ConfirmModal
        open={!!tableToDrop}
        onOpenChange={(open) => !open && setTableToDrop(null)}
        title="Drop table?"
        confirmLabel="Drop table"
        destructive
        description={
          tableToDrop ? (
            <p>
              Permanently drop table <strong>{tableToDrop.qualified_name}</strong> and all of its data? This cannot be
              undone.
            </p>
          ) : null
        }
        onConfirm={() => {
          dropTable().catch(console.error);
        }}
      />

      <Modal
        open={!!tableToRename}
        onOpenChange={(open) => {
          if (!open) {
            setTableToRename(null);
            setRenameDraft("");
          }
        }}
        title="Rename table"
      >
        {tableToRename ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Rename <strong>{tableToRename.qualified_name}</strong> to a new table name within the{" "}
              <strong>{tableToRename.schema}</strong> schema.
            </p>
            <div>
              <label htmlFor="rename-table-input" className="mb-1 block text-sm font-medium text-slate-700">
                New name
              </label>
              <Input
                id="rename-table-input"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                placeholder="table_name"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && renameDraft.trim()) {
                    renameTable().catch(console.error);
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setTableToRename(null);
                  setRenameDraft("");
                }}
              >
                Cancel
              </Button>
              <Button disabled={!renameDraft.trim() || busy} onClick={() => renameTable().catch(console.error)}>
                Rename
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function axiosErrorMessage(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return null;
  }
  const response = (err as { response?: { data?: { error?: string | Record<string, string[]> } } }).response;
  const payload = response?.data?.error;
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    return Object.values(payload).flat().join(", ");
  }
  return null;
}
