import { useCallback, useEffect, useMemo, useState } from "react";
import { Agent, api, Department } from "@/api/client";
import { ConfirmModal } from "@/components/ui/modal";
import { SortableTh } from "@/components/ui/sortable-table";
import { Button, Input, Label } from "@/components/ui/primitives";
import { useTableSort } from "@/hooks/useTableSort";
import { formatDate } from "@/lib/utils";
import {
  DataCard,
  DataCardActions,
  DataCardField,
  DataCardTitle,
  DesktopTableShell,
  MobileCardList,
} from "@/components/ui/data-card";

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortAccessors = useMemo(
    () => ({
      name: (row: Department) => row.name,
      created_at: (row: Department) => row.created_at ?? "",
    }),
    [],
  );
  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(departments, sortAccessors, "name");

  const load = useCallback(async () => {
    setLoading(true);
    const [deptRes, agentRes] = await Promise.all([
      api.get<Department[]>("/departments"),
      api.get<Agent[]>("/agents"),
    ]);
    setDepartments(deptRes.data);
    setAgents(agentRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const agentCount = (departmentName: string) =>
    agents.filter((agent) => agent.department === departmentName).length;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Departments</h1>
      <p className="text-sm text-slate-600">
        Creating a department adds <code>{`{name}/input/`}</code> under the workspace. Deleting a department does not
        remove workspace files.
      </p>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await api.post("/departments", { name });
            setName("");
            await load();
          } catch {
            setError("Could not create department. Use lowercase letters, numbers, underscores, or hyphens.");
          }
        }}
      >
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor="department-name">New department</Label>
          <Input
            id="department-name"
            placeholder="research"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!name.trim()}>
          Create
        </Button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <DesktopTableShell>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <SortableTh label="Name" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh
                    label="Created"
                    sortKey="created_at"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-2">Agents</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((department) => (
                  <tr key={department.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{department.name}</td>
                    <td className="px-4 py-2">{formatDate(department.created_at)}</td>
                    <td className="px-4 py-2">{agentCount(department.name)}</td>
                    <td className="px-4 py-2">
                      <Button
                        variant="outline"
                        disabled={agentCount(department.name) > 0}
                        onClick={() => setDeleteTarget(department)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableShell>

          <MobileCardList>
            {sorted.map((department) => (
              <DataCard key={department.id}>
                <DataCardTitle>{department.name}</DataCardTitle>
                <dl>
                  <DataCardField label="Created">{formatDate(department.created_at)}</DataCardField>
                  <DataCardField label="Agents">{agentCount(department.name)}</DataCardField>
                </dl>
                <DataCardActions>
                  <Button
                    variant="outline"
                    disabled={agentCount(department.name) > 0}
                    onClick={() => setDeleteTarget(department)}
                  >
                    Delete
                  </Button>
                </DataCardActions>
              </DataCard>
            ))}
          </MobileCardList>
        </>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete department?"
        confirmLabel="Delete"
        destructive
        description={
          deleteTarget ? (
            <p>
              Delete department <strong>{deleteTarget.name}</strong>? Workspace folders are kept.{" "}
              {agentCount(deleteTarget.name) > 0
                ? "This department still has agents and cannot be deleted."
                : "This cannot be undone."}
            </p>
          ) : null
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api.delete(`/departments/${deleteTarget.id}`);
          setDeleteTarget(null);
          await load();
        }}
      />
    </div>
  );
}
