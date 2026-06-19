import { useCallback, useEffect, useMemo, useState } from "react";
import { Agent, api, ModelsResponse } from "@/api/client";
import { AgentDetailSummary } from "@/components/agents/AgentDetailSummary";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";
import {
  EnabledToggle,
  InlineCrondInput,
  InlineModelSelect,
  InlineTimeoutInput,
} from "@/components/agents/AgentInlineCells";
import { formatTimeoutSeconds, parseTimeoutInput } from "@/lib/timeout";
import { ConfirmModal } from "@/components/ui/modal";
import { SortableTh } from "@/components/ui/sortable-table";
import { Button } from "@/components/ui/primitives";
import { getCrontabError } from "@/lib/crontab";
import { useTableSort } from "@/hooks/useTableSort";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteAgent, setDeleteAgent] = useState<Agent | null>(null);
  const [triggerAgent, setTriggerAgent] = useState<Agent | null>(null);
  const [draftCrond, setDraftCrond] = useState<Record<number, string>>({});
  const [draftTimeout, setDraftTimeout] = useState<Record<number, string>>({});

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

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(agents, sortAccessors, "name");

  const load = useCallback(async () => {
    setLoading(true);
    const [agentsRes, modelsRes] = await Promise.all([
      api.get<Agent[]>("/agents"),
      api.get<ModelsResponse>("/models"),
    ]);
    setAgents(agentsRes.data);
    setModels(modelsRes.data.models);
    setDraftCrond(Object.fromEntries(agentsRes.data.map((agent) => [agent.id, agent.crond || ""])));
    setDraftTimeout(
      Object.fromEntries(agentsRes.data.map((agent) => [agent.id, formatTimeoutSeconds(agent.timeout_seconds)])),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const patchAgent = async (
    agent: Agent,
    patch: Partial<Pick<Agent, "model" | "enabled" | "crond" | "timeout_seconds">>,
  ) => {
    await api.put(`/agents/${agent.id}`, patch);
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
    if (seconds === null || seconds === agent.timeout_seconds) return;
    await patchAgent(agent, { timeout_seconds: seconds });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <Button onClick={() => setFormOpen(true)}>New Agent</Button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
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
                  <td className="px-4 py-2 font-medium">{agent.name}</td>
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
        </div>
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
        }}
      />
    </div>
  );
}
