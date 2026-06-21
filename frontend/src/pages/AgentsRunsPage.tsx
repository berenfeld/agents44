import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AgentRun, api } from "@/api/client";
import { SortableTh } from "@/components/ui/sortable-table";
import { ViewRowMenu } from "@/components/ui/view-row-menu";
import { formatCost, formatDate, formatDuration, runDurationSeconds } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { useTableSort } from "@/hooks/useTableSort";

function filesUrl(path: string) {
  return `/agents_files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export default function AgentsRunsPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const sortAccessors = useMemo(
    () => ({
      id: (run: AgentRun) => run.id,
      agent_name: (run: AgentRun) => run.agent_name || String(run.agent_id),
      status: (run: AgentRun) => run.status,
      model: (run: AgentRun) => run.model ?? "",
      tokens_in: (run: AgentRun) => run.tokens_in,
      tokens_out: (run: AgentRun) => run.tokens_out,
      estimated_cost_usd: (run: AgentRun) => run.estimated_cost_usd,
      trigger_source: (run: AgentRun) => run.trigger_source,
      started_at: (run: AgentRun) => run.started_at ?? "",
      duration: (run: AgentRun) => runDurationSeconds(run.started_at, run.finished_at) ?? -1,
      prompt_preview: (run: AgentRun) => run.prompt_preview ?? "",
    }),
    [],
  );

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(runs, sortAccessors, "id");

  const load = async () => {
    const res = await api.get<{ items: AgentRun[] }>("/runs");
    setRuns(res.data.items);
  };

  useEffect(() => {
    load().catch(console.error);
    const timer = setInterval(() => load().catch(console.error), 5000);
    return () => clearInterval(timer);
  }, []);

  const openModal = async (title: string, fetchContent: () => Promise<string>) => {
    setModalTitle(title);
    setModalContent("Loading...");
    setModalOpen(true);
    try {
      setModalContent(await fetchContent());
    } catch {
      setModalContent("(could not load)");
    }
  };

  const openPrompt = (run: AgentRun) => {
    openModal(`Run #${run.id} prompt`, async () => {
      const res = await api.get<{ prompt: string }>(`/runs/${run.id}/prompt`);
      return res.data.prompt || "(empty)";
    });
  };

  const openLog = (run: AgentRun) => {
    openModal(`Run #${run.id} log`, async () => {
      const res = await api.get<{ log: string }>(`/runs/${run.id}/log`);
      return res.data.log || "(empty)";
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Agents Runs</h1>
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <SortableTh label="ID" sortKey="id" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              <SortableTh
                label="Agent"
                sortKey="agent_name"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
              />
              <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              <SortableTh label="Model" sortKey="model" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
              <SortableTh
                label="Tokens in"
                sortKey="tokens_in"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Tokens out"
                sortKey="tokens_out"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Est. cost"
                sortKey="estimated_cost_usd"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Trigger"
                sortKey="trigger_source"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Started"
                sortKey="started_at"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Duration"
                sortKey="duration"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
              />
              <th className="px-4 py-2">Run folder</th>
              <th className="px-4 py-2">Prompt</th>
              <th className="px-4 py-2">Log</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((run) => (
              <tr key={run.id} className="border-t">
                <td className="px-4 py-2">{run.id}</td>
                <td className="px-4 py-2">{run.agent_name || run.agent_id}</td>
                <td className="px-4 py-2">{run.status}</td>
                <td className="px-4 py-2">{run.model || "-"}</td>
                <td className="px-4 py-2">{run.tokens_in ?? "-"}</td>
                <td className="px-4 py-2">{run.tokens_out ?? "-"}</td>
                <td className="px-4 py-2">{formatCost(run.estimated_cost_usd)}</td>
                <td className="px-4 py-2">{run.trigger_source}</td>
                <td className="px-4 py-2">{formatDate(run.started_at)}</td>
                <td className="px-4 py-2">{formatDuration(run.started_at, run.finished_at)}</td>
                <td className="px-4 py-2">
                  {run.run_dir ? (
                    <Link to={filesUrl(run.run_dir)} className="text-slate-700 hover:underline">
                      {run.run_dir.split("/").pop()}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-2">
                  <ViewRowMenu
                    label="View prompt"
                    onView={() => openPrompt(run)}
                    disabled={!run.prompt_path && !run.prompt_preview}
                  />
                </td>
                <td className="px-4 py-2">
                  <ViewRowMenu label="View log" onView={() => openLog(run)} disabled={!run.log_path} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={modalTitle} size="large">
        <div className="max-h-[75vh] overflow-y-auto rounded border bg-white">
          <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm text-slate-900">
            {modalContent || "(empty)"}
          </pre>
        </div>
      </Modal>
    </div>
  );
}
