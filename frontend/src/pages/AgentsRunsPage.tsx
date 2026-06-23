import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AgentRun, api } from "@/api/client";
import { RunLogViewer } from "@/components/agents/RunLogViewer";
import { RunSearchToolbar } from "@/components/agents/RunSearchToolbar";
import { RunStatusBadge } from "@/components/agents/RunStatusBadge";
import { RunSummaryViewer } from "@/components/agents/RunSummaryViewer";
import { StopRunButton } from "@/components/agents/StopRunButton";
import { SortableTh } from "@/components/ui/sortable-table";
import { ViewRowMenu } from "@/components/ui/view-row-menu";
import { cn, formatCost, formatDate, formatDuration, formatTokens, runDurationSeconds, runTokensTotal } from "@/lib/utils";
import { countMatches } from "@/lib/search-highlight";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { useTableSort, type SortDirection } from "@/hooks/useTableSort";
import {
  DataCard,
  DataCardActions,
  DataCardField,
  DataCardTitle,
  DesktopTableShell,
  MobileCardList,
} from "@/components/ui/data-card";
import { Button } from "@/components/ui/primitives";

function filesUrl(path: string) {
  return `/agents_files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function isActiveRun(status: string) {
  return status === "running" || status === "pending";
}

function isRunningRun(status: string) {
  return status === "running";
}

const RUNS_SORT_KEYS = new Set([
  "id",
  "agent_name",
  "status",
  "model",
  "tokens",
  "estimated_cost_usd",
  "trigger_source",
  "started_at",
  "duration",
  "prompt_preview",
]);
const DEFAULT_RUNS_SORT_KEY = "started_at";
const DEFAULT_RUNS_SORT_DIR: SortDirection = "desc";

function parseRunsSortParams(searchParams: URLSearchParams): { sortKey: string; sortDir: SortDirection } {
  const sortBy = searchParams.get("sort_by");
  const sortDirParam = searchParams.get("sort_dir");
  if (!sortBy && !sortDirParam) {
    return { sortKey: DEFAULT_RUNS_SORT_KEY, sortDir: DEFAULT_RUNS_SORT_DIR };
  }
  const sortKey = sortBy && RUNS_SORT_KEYS.has(sortBy) ? sortBy : DEFAULT_RUNS_SORT_KEY;
  const sortDir = sortDirParam === "desc" ? "desc" : "asc";
  return { sortKey, sortDir };
}

function buildRunsSortParams(sortKey: string, sortDir: SortDirection, current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(current);
  if (sortKey === DEFAULT_RUNS_SORT_KEY && sortDir === DEFAULT_RUNS_SORT_DIR) {
    params.delete("sort_by");
    params.delete("sort_dir");
  } else {
    params.set("sort_by", sortKey);
    if (sortDir === "desc") {
      params.set("sort_dir", "desc");
    } else {
      params.delete("sort_dir");
    }
  }
  return params;
}

function sumRunTotals(items: AgentRun[]) {
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let hasTokens = false;
  let hasCost = false;

  for (const run of items) {
    if (run.tokens_in != null || run.tokens_out != null) {
      hasTokens = true;
      tokensIn += run.tokens_in ?? 0;
      tokensOut += run.tokens_out ?? 0;
    }
    if (run.estimated_cost_usd != null) {
      hasCost = true;
      cost += run.estimated_cost_usd;
    }
  }

  return {
    tokensIn: hasTokens ? tokensIn : null,
    tokensOut: hasTokens ? tokensOut : null,
    cost: hasCost ? cost : null,
  };
}

export default function AgentsRunsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sortKey, sortDir } = useMemo(() => parseRunsSortParams(searchParams), [searchParams]);
  const agentFilter = searchParams.get("agent_id") ?? "";

  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalKind, setModalKind] = useState<"log" | "prompt" | "summary" | null>(null);
  const [modalRunId, setModalRunId] = useState<number | null>(null);
  const [modalSearch, setModalSearch] = useState("");
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [stopRun, setStopRun] = useState<AgentRun | null>(null);
  const [stoppingRunId, setStoppingRunId] = useState<number | null>(null);

  const sortAccessors = useMemo(
    () => ({
      id: (run: AgentRun) => run.id,
      agent_name: (run: AgentRun) => run.agent_name || String(run.agent_id),
      status: (run: AgentRun) => run.status,
      model: (run: AgentRun) => run.model ?? "",
      tokens: (run: AgentRun) => runTokensTotal(run.tokens_in, run.tokens_out),
      estimated_cost_usd: (run: AgentRun) => run.estimated_cost_usd,
      trigger_source: (run: AgentRun) => run.trigger_source,
      started_at: (run: AgentRun) => run.started_at ?? "",
      duration: (run: AgentRun) => runDurationSeconds(run.started_at, run.finished_at) ?? -1,
      prompt_preview: (run: AgentRun) => run.prompt_preview ?? "",
    }),
    [],
  );

  const agentOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const run of runs) {
      map.set(run.agent_id, run.agent_name || String(run.agent_id));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [runs]);

  const filteredRuns = useMemo(() => {
    if (!agentFilter) return runs;
    const agentId = Number(agentFilter);
    if (Number.isNaN(agentId)) return runs;
    return runs.filter((run) => run.agent_id === agentId);
  }, [runs, agentFilter]);

  const runTotals = useMemo(() => sumRunTotals(filteredRuns), [filteredRuns]);

  const onSortChange = useCallback(
    (nextSortKey: string | null, nextSortDir: SortDirection) => {
      setSearchParams(
        (current) => buildRunsSortParams(nextSortKey ?? DEFAULT_RUNS_SORT_KEY, nextSortDir, current),
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const { sorted, sortKey: activeSortKey, sortDir: activeSortDir, toggleSort } = useTableSort(
    filteredRuns,
    sortAccessors,
    DEFAULT_RUNS_SORT_KEY,
    { sortKey, sortDir, onSortChange },
  );

  const modalRun = useMemo(
    () => (modalRunId == null ? null : runs.find((run) => run.id === modalRunId) ?? null),
    [modalRunId, runs],
  );

  const modalMatchCount = useMemo(
    () => countMatches(modalContent, modalSearch),
    [modalContent, modalSearch],
  );

  const modalLive =
    modalRun != null &&
    isActiveRun(modalRun.status) &&
    (modalKind === "log" ||
      (modalKind === "summary" && (!modalContent.trim() || modalContent === "(empty)")));
  const modalLogLive = modalLive && modalKind === "log";

  const modalSearchPlaceholder =
    modalKind === "log"
      ? "Search log…"
      : modalKind === "prompt"
        ? "Search prompt…"
        : modalKind === "summary"
          ? "Search summary…"
          : "Search…";

  const load = useCallback(async () => {
    const res = await api.get<{ items: AgentRun[] }>("/runs");
    setRuns(res.data.items);
  }, []);

  const fetchLog = useCallback(async (runId: number) => {
    const res = await api.get<{ log: string }>(`/runs/${runId}/log`);
    return res.data.log || "(empty)";
  }, []);

  const fetchPrompt = useCallback(async (runId: number) => {
    const res = await api.get<{ prompt: string }>(`/runs/${runId}/prompt`);
    return res.data.prompt || "(empty)";
  }, []);

  const fetchSummary = useCallback(async (runId: number) => {
    const res = await api.get<{ summary: string }>(`/runs/${runId}/summary`);
    return res.data.summary || "(empty)";
  }, []);

  useEffect(() => {
    load().catch(console.error);
    const timer = setInterval(() => load().catch(console.error), 5000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!modalOpen || modalRunId == null) {
      return;
    }
    if (!modalRun || !isActiveRun(modalRun.status)) {
      return;
    }

    const refresh = () => {
      if (modalKind === "log") {
        fetchLog(modalRunId)
          .then(setModalContent)
          .catch(console.error);
        return;
      }
      if (modalKind === "summary") {
        fetchSummary(modalRunId)
          .then(setModalContent)
          .catch(console.error);
      }
    };

    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [modalOpen, modalKind, modalRunId, modalRun, fetchLog, fetchSummary]);

  const openModal = async (
    title: string,
    kind: "log" | "prompt" | "summary",
    runId: number,
    fetchContent: () => Promise<string>,
  ) => {
    setModalTitle(title);
    setModalKind(kind);
    setModalRunId(runId);
    setModalSearch("");
    setLogAutoScroll(true);
    setModalContent("Loading...");
    setModalOpen(true);
    try {
      setModalContent(await fetchContent());
    } catch {
      setModalContent("(could not load)");
    }
  };

  const openPrompt = (run: AgentRun) => {
    openModal(`Run #${run.id} prompt`, "prompt", run.id, () => fetchPrompt(run.id));
  };

  const openLog = (run: AgentRun) => {
    openModal(`Run #${run.id} log`, "log", run.id, () => fetchLog(run.id));
  };

  const openSummary = (run: AgentRun) => {
    openModal(`Run #${run.id} summary`, "summary", run.id, () => fetchSummary(run.id));
  };

  const handleModalOpenChange = (open: boolean) => {
    setModalOpen(open);
    if (!open) {
      setModalKind(null);
      setModalRunId(null);
      setModalSearch("");
    }
  };

  const confirmStopRun = async () => {
    if (!stopRun) return;
    setStoppingRunId(stopRun.id);
    try {
      await api.post(`/runs/${stopRun.id}/stop`);
      setStopRun(null);
      await load();
    } catch (error) {
      console.error(error);
    } finally {
      setStoppingRunId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <h1 className="text-2xl font-semibold">Agents Runs</h1>
        <select
          id="runs-agent-filter"
          aria-label="Filter by agent"
          className={cn(
            "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 md:w-auto md:min-w-[12rem]",
          )}
          value={agentFilter}
          onChange={(e) => {
            setSearchParams(
              (current) => {
                const params = new URLSearchParams(current);
                if (e.target.value) {
                  params.set("agent_id", e.target.value);
                } else {
                  params.delete("agent_id");
                }
                return params;
              },
              { replace: true },
            );
          }}
        >
          <option value="">All agents</option>
          {agentOptions.map(([id, name]) => (
            <option key={id} value={String(id)}>
              {name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600">
          <p>
            <span className="font-medium text-slate-700">Total tokens:</span>{" "}
            <span className="tabular-nums">{formatTokens(runTotals.tokensIn, runTotals.tokensOut)}</span>
          </p>
          <p>
            <span className="font-medium text-slate-700">Total cost:</span>{" "}
            <span className="tabular-nums">{formatCost(runTotals.cost)}</span>
          </p>
        </div>
      </div>

      <DesktopTableShell>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <SortableTh label="ID" sortKey="id" activeKey={activeSortKey} direction={activeSortDir} onSort={toggleSort} />
              <SortableTh
                label="Agent"
                sortKey="agent_name"
                activeKey={activeSortKey}
                direction={activeSortDir}
                onSort={toggleSort}
              />
              <SortableTh label="Status" sortKey="status" activeKey={activeSortKey} direction={activeSortDir} onSort={toggleSort} />
              <SortableTh label="Model" sortKey="model" activeKey={activeSortKey} direction={activeSortDir} onSort={toggleSort} />
              <SortableTh label="Tokens" sortKey="tokens" activeKey={activeSortKey} direction={activeSortDir} onSort={toggleSort} />
              <SortableTh
                label="Est. cost"
                sortKey="estimated_cost_usd"
                activeKey={activeSortKey}
                direction={activeSortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Trigger"
                sortKey="trigger_source"
                activeKey={activeSortKey}
                direction={activeSortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Started"
                sortKey="started_at"
                activeKey={activeSortKey}
                direction={activeSortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label="Duration"
                sortKey="duration"
                activeKey={activeSortKey}
                direction={activeSortDir}
                onSort={toggleSort}
              />
              <th className="px-4 py-2">Run folder</th>
              <th className="px-4 py-2">Prompt</th>
              <th className="px-4 py-2">Log</th>
              <th className="px-4 py-2">Summary</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((run) => (
              <tr key={run.id} className="border-t">
                <td className="px-4 py-2">{run.id}</td>
                <td className="px-4 py-2">{run.agent_name || run.agent_id}</td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    <RunStatusBadge status={run.status} />
                    {isRunningRun(run.status) ? (
                      <StopRunButton
                        onClick={() => setStopRun(run)}
                        disabled={stoppingRunId === run.id}
                      />
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-2">{run.model || "-"}</td>
                <td className="px-4 py-2 tabular-nums">{formatTokens(run.tokens_in, run.tokens_out)}</td>
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
                  <ViewRowMenu
                    label="View log"
                    onView={() => openLog(run)}
                    disabled={!run.log_path && !isActiveRun(run.status)}
                  />
                </td>
                <td className="px-4 py-2">
                  <ViewRowMenu
                    label="View summary"
                    onView={() => openSummary(run)}
                    disabled={!run.run_dir && !isActiveRun(run.status)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DesktopTableShell>

      <MobileCardList>
        {sorted.map((run) => (
          <DataCard key={run.id}>
            <DataCardTitle>
              Run #{run.id} · {run.agent_name || run.agent_id}
            </DataCardTitle>
            <dl>
              <DataCardField label="Status">
                <span className="inline-flex items-center gap-1">
                  <RunStatusBadge status={run.status} />
                  {isRunningRun(run.status) ? (
                    <StopRunButton
                      onClick={() => setStopRun(run)}
                      disabled={stoppingRunId === run.id}
                    />
                  ) : null}
                </span>
              </DataCardField>
              <DataCardField label="Model">{run.model || "-"}</DataCardField>
              <DataCardField label="Tokens">
                <span className="tabular-nums">{formatTokens(run.tokens_in, run.tokens_out)}</span>
              </DataCardField>
              <DataCardField label="Est. cost">{formatCost(run.estimated_cost_usd)}</DataCardField>
              <DataCardField label="Trigger">{run.trigger_source}</DataCardField>
              <DataCardField label="Started">{formatDate(run.started_at)}</DataCardField>
              <DataCardField label="Duration">{formatDuration(run.started_at, run.finished_at)}</DataCardField>
              <DataCardField label="Run folder">
                {run.run_dir ? (
                  <Link to={filesUrl(run.run_dir)} className="break-all text-slate-700 hover:underline">
                    {run.run_dir.split("/").pop()}
                  </Link>
                ) : (
                  "-"
                )}
              </DataCardField>
            </dl>
            <DataCardActions>
              <Button
                variant="outline"
                disabled={!run.prompt_path && !run.prompt_preview}
                onClick={() => openPrompt(run)}
              >
                Prompt
              </Button>
              <Button
                variant="outline"
                disabled={!run.log_path && !isActiveRun(run.status)}
                onClick={() => openLog(run)}
              >
                Log
              </Button>
              <Button
                variant="outline"
                disabled={!run.run_dir && !isActiveRun(run.status)}
                onClick={() => openSummary(run)}
              >
                Summary
              </Button>
            </DataCardActions>
          </DataCard>
        ))}
      </MobileCardList>

      <Modal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        title={modalTitle}
        size="large"
        headerExtra={
          modalKind ? (
            <RunSearchToolbar
              search={modalSearch}
              onSearchChange={setModalSearch}
              placeholder={modalSearchPlaceholder}
              matchCount={modalMatchCount}
              live={modalLive}
              liveLabel={modalKind === "summary" ? "Waiting" : "Live"}
              autoScroll={modalLogLive ? logAutoScroll : undefined}
              onAutoScrollChange={modalLogLive ? setLogAutoScroll : undefined}
            />
          ) : null
        }
      >
        {modalKind === "log" || modalKind === "prompt" ? (
          <RunLogViewer content={modalContent} search={modalSearch} autoScroll={modalLogLive && logAutoScroll} />
        ) : modalKind === "summary" ? (
          <RunSummaryViewer content={modalContent} search={modalSearch} />
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!stopRun}
        onOpenChange={(open) => !open && setStopRun(null)}
        title="Stop run?"
        confirmLabel="Stop"
        destructive
        description={
          stopRun ? (
            <p>
              Send SIGTERM to run <strong>#{stopRun.id}</strong> ({stopRun.agent_name || stopRun.agent_id})? The
              agent may finish gracefully if it writes <code>summary.md</code>, or the run may fail.
            </p>
          ) : null
        }
        onConfirm={confirmStopRun}
      />
    </div>
  );
}
