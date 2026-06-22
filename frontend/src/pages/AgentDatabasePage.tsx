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
import { ConfirmModal } from "@/components/ui/modal";
import { Input } from "@/components/ui/primitives";
import {
  DataCard,
  DataCardField,
  DataCardTitle,
  MobileCardList,
} from "@/components/ui/data-card";
import { PanelCard, SplitPanelLayout } from "@/components/ui/split-panel-layout";
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

function parseAgentDbSearchParams(searchParams: URLSearchParams): { table: string | null; query: RowQueryState } {
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

  return { table: searchParams.get("table"), query };
}

function buildAgentDbSearchParams(table: string | null, query: RowQueryState): URLSearchParams {
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

function emptyRow(schema: AgentDbSchema): GridRow {
  const row: GridRow = { _rowId: crypto.randomUUID(), _isNew: true };
  for (const col of schema.columns) {
    if (col.primary_key && col.autoincrement) {
      continue;
    }
    if (col.default != null) {
      row[col.name] = col.default;
      continue;
    }
    row[col.name] = col.type === "boolean" ? false : null;
  }
  return row;
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
): Column<GridRow>[] {
  const dataColumns = schema.columns.map((col: AgentDbColumn) => {
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
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "destructive";
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
      )}
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
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

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
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

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />;
}

export default function AgentDatabasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { table: selectedTable, query } = useMemo(
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
  const [draftFilter, setDraftFilter] = useState({
    filterColumn: query.filterColumn,
    filterOp: query.filterOp,
    filterValue: query.filterValue,
  });
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const setTableAndQuery = useCallback(
    (table: string | null, nextQuery: RowQueryState, options?: { replace?: boolean }) => {
      setSearchParams(buildAgentDbSearchParams(table, nextQuery), { replace: options?.replace ?? true });
    },
    [setSearchParams],
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
    () => (schema ? buildColumns(schema, query.sortBy, query.sortDir, handleSort) : []),
    [schema, query.sortBy, query.sortDir, handleSort],
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

  const addRow = () => {
    if (!schema) return;
    setRows((current) => [emptyRow(schema), ...current]);
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
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Tables</h2>
      <div className="space-y-3">
        {tablesBySchema.map(([schemaName, schemaTables]) => (
          <div key={schemaName}>
            <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {schemaName}
            </h3>
            <ul className="space-y-1">
              {schemaTables.map((table) => (
                <li key={table.qualified_name}>
                  <button
                    type="button"
                    onClick={() => setTableAndQuery(table.qualified_name, defaultQueryState())}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                      selectedTable === table.qualified_name
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="font-medium">{table.name}</span>
                    <span
                      className={`ml-1 text-xs ${
                        selectedTable === table.qualified_name ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      ({table.row_count})
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
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

      <SplitPanelLayout
        sidebar={
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
            {renderTableSidebar("hidden md:block")}
          </>
        }
      >
          <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto rounded-lg border bg-white px-2 py-1.5">
            <ToolbarIconButton title="Add row" onClick={addRow} disabled={!schema || busy}>
              <PlusIcon />
            </ToolbarIconButton>
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
                <ToolbarDivider />
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
              </>
            ) : null}

            <ToolbarDivider />
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

            <span className="ml-auto shrink-0 truncate text-xs text-slate-500">
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

          <div className="hidden rounded-lg border bg-white md:block">
            {loading ? (
              <div className="p-8 text-sm text-slate-500">Loading…</div>
            ) : schema && selectedTable ? (
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
                    {schema.columns.map((col) => {
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
              mobile, edit fields directly in each card. New rows insert after you fill required fields.
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
