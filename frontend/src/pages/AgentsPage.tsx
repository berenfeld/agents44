import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Agent, api, buildAgentWritePayload, Department, ModelsResponse } from "@/api/client";
import { AgentDetailSummary } from "@/components/agents/AgentDetailSummary";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";
import { AgentRunningTag } from "@/components/agents/AgentRunningTag";
import {
  EnabledToggle,
  InlineCrondInput,
  InlineModelSelect,
  InlineTimeoutInput,
} from "@/components/agents/AgentInlineCells";
import { formatTimeoutSeconds, parseTimeoutInput } from "@/lib/timeout";
import { describeTimeoutChangeImpact } from "@/lib/run-timeout";
import { ConfirmModal } from "@/components/ui/modal";
import { SortableTh } from "@/components/ui/sortable-table";
import { Button } from "@/components/ui/primitives";
import { getCrontabError } from "@/lib/crontab";
import { useTableSort } from "@/hooks/useTableSort";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
  DataCard,
  DataCardActions,
  DataCardField,
  DataCardTitle,
  DesktopTableShell,
  MobileCardList,
} from "@/components/ui/data-card";

export default function AgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const departmentFilter = searchParams.get("department") ?? "";

  const [agents, setAgents] = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteAgent, setDeleteAgent] = useState<Agent | null>(null);
  const [triggerAgent, setTriggerAgent] = useState<Agent | null>(null);
  const [draftCrond, setDraftCrond] = useState<Record<number, string>>({});
  const [draftTimeout, setDraftTimeout] = useState<Record<number, string>>({});
  const [pendingTimeoutChange, setPendingTimeoutChange] = useState<{
    agent: Agent;
    newTimeoutSeconds: number;
  } | null>(null);

  const sortAccessors = useMemo(
    () => ({
      name: (agent: Agent) => agent.name,
      department: (agent: Agent) => agent.department,
      model: (agent: Agent) => agent.model,
      crond: (agent: Agent) => agent.crond ?? "",
      enabled: (agent: Agent) => agent.enabled,
      timeout_seconds: (agent: Agent) => agent.timeout_seconds,
    }),
    [],
  );

  const departmentOptions = useMemo(() => {
    const names = new Set<string>();
    for (const department of departments) {
      names.add(department.name);
    }
    for (const agent of agents) {
      names.add(agent.department);
    }
    if (departmentFilter) {
      names.add(departmentFilter);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [agents, departmentFilter, departments]);

  const filteredAgents = useMemo(() => {
    if (!departmentFilter) return agents;
    return agents.filter((agent) => agent.department === departmentFilter);
  }, [agents, departmentFilter]);

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(filteredAgents, sortAccessors, "name");

  const load = useCallback(async () => {
    setLoading(true);
    const [agentsRes, modelsRes, departmentsRes] = await Promise.all([
      api.get<Agent[]>("/agents"),
      api.get<ModelsResponse>("/models"),
      api.get<Department[]>("/departments"),
    ]);
    setAgents(agentsRes.data);
    setModels(modelsRes.data.models);
    setDepartments(departmentsRes.data);
    setDraftCrond(Object.fromEntries(agentsRes.data.map((agent) => [agent.id, agent.crond || ""])));
    setDraftTimeout(
      Object.fromEntries(agentsRes.data.map((agent) => [agent.id, formatTimeoutSeconds(agent.timeout_seconds)])),
    );
    setLoading(false);
  }, []);

  const refreshRunningStatus = useCallback(async () => {
    const res = await api.get<Agent[]>("/agents");
    const byId = new Map(res.data.map((agent) => [agent.id, agent]));
    setAgents((prev) =>
      prev.map((agent) => {
        const fresh = byId.get(agent.id);
        if (!fresh) return agent;
        if (
          fresh.is_running === agent.is_running &&
          fresh.active_run?.id === agent.active_run?.id &&
          fresh.active_run?.timeout_seconds === agent.active_run?.timeout_seconds
        ) {
          return agent;
        }
        return {
          ...agent,
          is_running: fresh.is_running,
          active_run: fresh.active_run,
        };
      }),
    );
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => refreshRunningStatus().catch(console.error), 5000);
    return () => clearInterval(timer);
  }, [loading, refreshRunningStatus]);

  const patchAgent = async (
    agent: Agent,
    patch: Partial<Pick<Agent, "model" | "enabled" | "crond" | "timeout_seconds">>,
  ) => {
    await api.put(`/agents/${agent.id}`, buildAgentWritePayload({ ...agent, ...patch }));
    await load();
  };

  const saveCrond = async (agent: Agent) => {
    const draft = draftCrond[agent.id] ?? "";
    if (getCrontabError(draft)) return;
    const normalized = draft.trim() || null;
    if (normalized === (agent.crond || null)) return;
    await patchAgent(agent, { crond: normalized });
  };

  const saveTimeout = async (agent: Agent) => {
    const draft = draftTimeout[agent.id] ?? "";
    const seconds = parseTimeoutInput(draft);
    if (seconds === null) return;
    const formatted = formatTimeoutSeconds(seconds);
    if (seconds === agent.timeout_seconds) {
      if (draft !== formatted) {
        setDraftTimeout((prev) => ({ ...prev, [agent.id]: formatted }));
      }
      return;
    }
    if (agent.is_running && agent.active_run) {
      setPendingTimeoutChange({ agent, newTimeoutSeconds: seconds });
      return;
    }
    await patchAgent(agent, { timeout_seconds: seconds });
  };

  const confirmTimeoutChange = async () => {
    if (!pendingTimeoutChange) return;
    const { agent, newTimeoutSeconds } = pendingTimeoutChange;
    await patchAgent(agent, { timeout_seconds: newTimeoutSeconds });
    setPendingTimeoutChange(null);
  };

  const revertTimeout = (agent: Agent) => {
    setDraftTimeout((prev) => ({
      ...prev,
      [agent.id]: formatTimeoutSeconds(agent.timeout_seconds),
    }));
  };

  const pendingTimeoutImpact = useMemo(() => {
    if (!pendingTimeoutChange?.agent.active_run) return null;
    const lines = describeTimeoutChangeImpact(
      pendingTimeoutChange.agent.name,
      pendingTimeoutChange.agent.active_run,
      pendingTimeoutChange.agent.timeout_seconds,
      pendingTimeoutChange.newTimeoutSeconds,
    );
    const immediate = lines.some((line) => line.includes("immediately"));
    return { lines, immediate };
  }, [pendingTimeoutChange]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agents"
        filters={
          <select
            id="agents-department-filter"
            aria-label="Filter by department"
            className={cn(
              "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 sm:w-auto sm:min-w-[12rem]",
            )}
            value={departmentFilter}
            onChange={(e) => {
              setSearchParams(
                (current) => {
                  const params = new URLSearchParams(current);
                  if (e.target.value) {
                    params.set("department", e.target.value);
                  } else {
                    params.delete("department");
                  }
                  return params;
                },
                { replace: true },
              );
            }}
          >
            <option value="">All departments</option>
            {departmentOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        }
        actions={<Button onClick={() => setFormOpen(true)}>New Agent</Button>}
      />

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
                    label="Department"
                    sortKey="department"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh label="Model" sortKey="model" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh label="Cron" sortKey="crond" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh
                    label="Timeout"
                    sortKey="timeout_seconds"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="Enabled"
                    sortKey="enabled"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((agent) => (
                  <tr key={agent.id} className="border-t">
                    <td className="px-4 py-2 font-medium">
                      <span className="inline-flex items-center gap-2">
                        {agent.name}
                        {agent.is_running ? <AgentRunningTag /> : null}
                      </span>
                    </td>
                    <td className="px-4 py-2">{agent.department}</td>
                    <td className="px-4 py-2">
                      <InlineModelSelect
                        value={agent.model}
                        models={models}
                        onChange={(model) => {
                          if (model !== agent.model) patchAgent(agent, { model }).catch(console.error);
                        }}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <InlineCrondInput
                        value={draftCrond[agent.id] ?? ""}
                        onChange={(value) => {
                          setDraftCrond((prev) => ({ ...prev, [agent.id]: value }));
                        }}
                        onCommit={() => saveCrond(agent).catch(console.error)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <InlineTimeoutInput
                        value={draftTimeout[agent.id] ?? formatTimeoutSeconds(agent.timeout_seconds)}
                        onChange={(value) => {
                          setDraftTimeout((prev) => ({ ...prev, [agent.id]: value }));
                        }}
                        onCommit={() => saveTimeout(agent).catch(console.error)}
                        onRevert={() => revertTimeout(agent)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <EnabledToggle
                        value={agent.enabled}
                        onChange={(enabled) => {
                          if (enabled !== agent.enabled) patchAgent(agent, { enabled }).catch(console.error);
                        }}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setDeleteAgent(agent)}>
                          Delete
                        </Button>
                        <Button onClick={() => setTriggerAgent(agent)}>Trigger now</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableShell>

          <MobileCardList>
            {sorted.map((agent) => (
              <DataCard key={agent.id}>
                <DataCardTitle>
                  <span className="inline-flex items-center gap-2">
                    {agent.name}
                    {agent.is_running ? <AgentRunningTag /> : null}
                  </span>
                </DataCardTitle>
                <dl>
                  <DataCardField label="Department">{agent.department}</DataCardField>
                  <DataCardField label="Model">
                    <InlineModelSelect
                      value={agent.model}
                      models={models}
                      onChange={(model) => {
                        if (model !== agent.model) patchAgent(agent, { model }).catch(console.error);
                      }}
                    />
                  </DataCardField>
                  <DataCardField label="Cron">
                    <InlineCrondInput
                      value={draftCrond[agent.id] ?? ""}
                      onChange={(value) => {
                        setDraftCrond((prev) => ({ ...prev, [agent.id]: value }));
                      }}
                      onCommit={() => saveCrond(agent).catch(console.error)}
                    />
                  </DataCardField>
                  <DataCardField label="Timeout">
                    <InlineTimeoutInput
                      value={draftTimeout[agent.id] ?? formatTimeoutSeconds(agent.timeout_seconds)}
                      onChange={(value) => {
                        setDraftTimeout((prev) => ({ ...prev, [agent.id]: value }));
                      }}
                      onCommit={() => saveTimeout(agent).catch(console.error)}
                      onRevert={() => revertTimeout(agent)}
                    />
                  </DataCardField>
                  <DataCardField label="Enabled">
                    <EnabledToggle
                      value={agent.enabled}
                      onChange={(enabled) => {
                        if (enabled !== agent.enabled) patchAgent(agent, { enabled }).catch(console.error);
                      }}
                    />
                  </DataCardField>
                </dl>
                <DataCardActions>
                  <Button variant="outline" onClick={() => setDeleteAgent(agent)}>
                    Delete
                  </Button>
                  <Button onClick={() => setTriggerAgent(agent)}>Trigger now</Button>
                </DataCardActions>
              </DataCard>
            ))}
          </MobileCardList>
        </>
      )}

      <AgentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={async (values) => {
          await api.post("/agents", values);
          await load();
        }}
      />

      <ConfirmModal
        open={!!pendingTimeoutChange}
        onOpenChange={(open) => {
          if (!open && pendingTimeoutChange) {
            revertTimeout(pendingTimeoutChange.agent);
            setPendingTimeoutChange(null);
          }
        }}
        title="Update timeout for running agent?"
        confirmLabel={pendingTimeoutImpact?.immediate ? "Update and stop" : "Update timeout"}
        destructive={!!pendingTimeoutImpact?.immediate}
        description={
          pendingTimeoutImpact ? (
            <div className="space-y-2">
              {pendingTimeoutImpact.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null
        }
        onConfirm={confirmTimeoutChange}
      />

      <ConfirmModal
        open={!!deleteAgent}
        onOpenChange={(open) => !open && setDeleteAgent(null)}
        title="Delete agent?"
        confirmLabel="Delete"
        destructive
        description={deleteAgent ? <AgentDetailSummary agent={deleteAgent} /> : null}
        onConfirm={async () => {
          if (!deleteAgent) return;
          await api.delete(`/agents/${deleteAgent.id}`);
          setDeleteAgent(null);
          await load();
        }}
      />

      <ConfirmModal
        open={!!triggerAgent}
        onOpenChange={(open) => !open && setTriggerAgent(null)}
        title="Trigger agent now?"
        confirmLabel="Trigger"
        description={triggerAgent ? <AgentDetailSummary agent={triggerAgent} /> : null}
        onConfirm={async () => {
          if (!triggerAgent) return;
          await api.post(`/agents/${triggerAgent.id}/trigger`, {});
          setTriggerAgent(null);
          await refreshRunningStatus();
        }}
      />
    </div>
  );
}
