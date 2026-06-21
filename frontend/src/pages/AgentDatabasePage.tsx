import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataGrid, { SelectColumn, type Column, type RowsChangeData } from "react-data-grid";
import {
  AgentDbColumn,
  AgentDbRow,
  AgentDbSchema,
  AgentDbTable,
  api,
} from "@/api/client";
import { ConfirmModal } from "@/components/ui/modal";
import { Button } from "@/components/ui/primitives";
import "react-data-grid/lib/styles.css";

type GridRow = AgentDbRow & {
  _rowId: string;
  _isNew?: boolean;
};

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

function buildColumns(schema: AgentDbSchema): Column<GridRow>[] {
  const dataColumns = schema.columns.map((col: AgentDbColumn) => {
    const editable = !(col.primary_key && col.autoincrement);
    return {
      key: col.name,
      name: col.primary_key ? `${col.name} (PK)` : col.name,
      editable,
      resizable: true,
      minWidth: 120,
      renderCell: ({ row }: { row: GridRow }) => <span className="truncate">{formatCell(row[col.name])}</span>,
    } satisfies Column<GridRow>;
  });
  return [SelectColumn, ...dataColumns];
}

function tableApiPath(qualifiedName: string) {
  return `/agent-db/tables/${encodeURIComponent(qualifiedName)}`;
}

export default function AgentDatabasePage() {
  const [tables, setTables] = useState<AgentDbTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [schema, setSchema] = useState<AgentDbSchema | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const loadTables = useCallback(async () => {
    const res = await api.get<AgentDbTable[]>("/agent-db/tables");
    setTables(res.data);
    if (!selectedTable && res.data.length > 0) {
      setSelectedTable(res.data[0].qualified_name);
    }
  }, [selectedTable]);

  const tablesBySchema = useMemo(() => {
    const grouped = new Map<string, AgentDbTable[]>();
    for (const table of tables) {
      const items = grouped.get(table.schema) ?? [];
      items.push(table);
      grouped.set(table.schema, items);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tables]);

  const loadTableData = useCallback(async (tableName: string) => {
    setLoading(true);
    setError(null);
    try {
      const [schemaRes, rowsRes] = await Promise.all([
        api.get<AgentDbSchema>(`${tableApiPath(tableName)}/schema`),
        api.get<{ items: AgentDbRow[]; total: number }>(`${tableApiPath(tableName)}/rows`),
      ]);
      setSchema(schemaRes.data);
      setRows(toGridRows(rowsRes.data.items, schemaRes.data));
      setTotal(rowsRes.data.total);
      setSelectedRows(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load table");
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
    if (selectedTable) {
      loadTableData(selectedTable).catch(console.error);
    }
  }, [selectedTable, loadTableData]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const columns = useMemo(() => (schema ? buildColumns(schema) : []), [schema]);

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Agent Database</h1>
        <p className="text-sm text-slate-600">
          Browse and edit tables across all PostgreSQL schemas (agent, department, and shared). System tables in{" "}
          <code>public</code> (<code>system_*</code>, <code>alembic_version</code>) are hidden. Cell edits save
          automatically.
        </p>
      </div>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="flex min-h-[32rem] gap-4">
        <aside className="w-64 shrink-0 rounded-lg border bg-white p-3">
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
                        onClick={() => setSelectedTable(table.qualified_name)}
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
        </aside>

        <section className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={addRow} disabled={!schema || busy}>
              Add row
            </Button>
            <Button
              variant="outline"
              onClick={() => selectedTable && loadTableData(selectedTable)}
              disabled={!selectedTable || loading || busy}
            >
              Refresh
            </Button>
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={deleteCount === 0 || busy}
            >
              Delete selected ({deleteCount})
            </Button>
            {busy ? <span className="text-sm text-slate-500">Saving…</span> : null}
            {selectedTable ? (
              <span className="ml-auto text-sm text-slate-500">
                {selectedTable} · {total} row{total === 1 ? "" : "s"}
                {rows.length < total ? ` (showing ${rows.length})` : ""}
              </span>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-lg border bg-white">
            {loading ? (
              <div className="p-8 text-sm text-slate-500">Loading…</div>
            ) : schema && selectedTable ? (
              <DataGrid
                className="rdg-light h-[28rem] text-sm"
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

          {schema ? (
            <p className="text-xs text-slate-500">
              Primary keys: {schema.primary_keys.join(", ") || "(none)"}. Double-click a cell to edit; new rows insert
              after you fill required fields.
            </p>
          ) : null}
        </section>
      </div>

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
