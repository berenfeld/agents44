import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Agent, api, Department, userFacingApiError, WhatsAppConversation } from "@/api/client";
import { NoticeModal } from "@/components/ui/modal";
import { Button, Input, Label } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { PanelCard, SplitPanelLayout } from "@/components/ui/split-panel-layout";
import { cn, formatDate } from "@/lib/utils";

const selectClassName =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 sm:w-auto sm:min-w-[12rem]";

function parseConversationId(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("h-4 w-4", className)} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function WhatsAppPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = parseConversationId(searchParams.get("conversation"));
  const departmentFilter = searchParams.get("department") ?? "";
  const agentFilter = searchParams.get("agent_id") ?? "";
  const fromFilter = searchParams.get("from_number") ?? "";
  const toFilter = searchParams.get("to_number") ?? "";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [conversation, setConversation] = useState<WhatsAppConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [fromDraft, setFromDraft] = useState(fromFilter);
  const [toDraft, setToDraft] = useState(toFilter);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFromDraft(fromFilter);
    setToDraft(toFilter);
  }, [fromFilter, toFilter]);

  const setParam = useCallback(
    (key: string, value: string) => {
      setSearchParams((current) => {
        const params = new URLSearchParams(current);
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
        return params;
      });
    },
    [setSearchParams],
  );

  const agentOptions = useMemo(() => {
    if (!departmentFilter) return agents;
    return agents.filter((agent) => agent.department === departmentFilter);
  }, [agents, departmentFilter]);

  const loadLists = useCallback(async () => {
    const [deptRes, agentRes] = await Promise.all([
      api.get<Department[]>("/departments"),
      api.get<Agent[]>("/agents"),
    ]);
    setDepartments(deptRes.data);
    setAgents(agentRes.data);
  }, []);

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams();
    if (departmentFilter) params.set("department", departmentFilter);
    if (agentFilter) params.set("agent_id", agentFilter);
    if (fromFilter) params.set("from_number", fromFilter);
    if (toFilter) params.set("to_number", toFilter);
    const query = params.toString();
    const res = await api.get<WhatsAppConversation[]>(`/whatsapp/conversations${query ? `?${query}` : ""}`);
    setConversations(res.data);
    return res.data;
  }, [agentFilter, departmentFilter, fromFilter, toFilter]);

  const loadThread = useCallback(async (id: number) => {
    setLoadingThread(true);
    try {
      const res = await api.get<WhatsAppConversation>(`/whatsapp/conversations/${id}`);
      setConversation(res.data);
    } catch (err) {
      setConversation(null);
      setNotice({ title: "Could not load conversation", message: userFacingApiError(err) });
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadLists();
        await loadConversations();
      } catch (err) {
        if (!cancelled) {
          setNotice({ title: "Could not load WhatsApp", message: userFacingApiError(err) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConversations, loadLists]);

  useEffect(() => {
    if (!selectedId) {
      setConversation(null);
      return;
    }
    if (loading) return;
    if (!conversations.some((row) => row.id === selectedId)) {
      setSearchParams((current) => {
        const params = new URLSearchParams(current);
        if (!params.get("conversation")) return current;
        params.delete("conversation");
        return params;
      });
      setConversation(null);
      return;
    }
    void loadThread(selectedId);
  }, [conversations, loadThread, loading, selectedId, setSearchParams]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation?.id, conversation?.messages?.length]);

  const applyNumberFilters = () => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (fromDraft.trim()) params.set("from_number", fromDraft.trim());
      else params.delete("from_number");
      if (toDraft.trim()) params.set("to_number", toDraft.trim());
      else params.delete("to_number");
      return params;
    });
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadConversations();
      if (selectedId) await loadThread(selectedId);
    } catch (err) {
      setNotice({ title: "Could not refresh WhatsApp", message: userFacingApiError(err) });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[32rem] flex-col gap-3">
      <PageHeader
        title="WhatsApp"
        filters={
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            <Label htmlFor="whatsapp-department" className="sr-only">
              Department
            </Label>
            <select
              id="whatsapp-department"
              aria-label="Department"
              className={selectClassName}
              value={departmentFilter}
              onChange={(event) => {
                const next = event.target.value;
                setSearchParams((current) => {
                  const params = new URLSearchParams(current);
                  if (next) params.set("department", next);
                  else params.delete("department");
                  const currentAgent = params.get("agent_id");
                  if (currentAgent && next) {
                    const agent = agents.find((row) => String(row.id) === currentAgent);
                    if (agent && agent.department !== next) params.delete("agent_id");
                  }
                  return params;
                });
              }}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.name}>
                  {department.name}
                </option>
              ))}
            </select>
            <Label htmlFor="whatsapp-agent" className="sr-only">
              Agent
            </Label>
            <select
              id="whatsapp-agent"
              aria-label="Agent"
              className={selectClassName}
              value={agentFilter}
              onChange={(event) => setParam("agent_id", event.target.value)}
            >
              <option value="">All agents</option>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <Input
              id="whatsapp-from"
              aria-label="From number"
              placeholder="From number"
              className="sm:w-40"
              value={fromDraft}
              onChange={(event) => setFromDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyNumberFilters();
              }}
            />
            <Input
              id="whatsapp-to"
              aria-label="To number"
              placeholder="To number"
              className="sm:w-40"
              value={toDraft}
              onChange={(event) => setToDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyNumberFilters();
              }}
            />
            <Button type="button" variant="outline" onClick={applyNumberFilters}>
              Filter
            </Button>
          </div>
        }
        actions={
          <Button type="button" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
            <span className="inline-flex items-center gap-2">
              <RefreshIcon className={refreshing ? "animate-spin" : undefined} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </span>
          </Button>
        }
      />

      <SplitPanelLayout
        className="min-h-0 flex-1"
        sidebarWidthKey="agents44.whatsapp.sidebarWidth"
        sidebar={
          <PanelCard className="flex max-h-full flex-col overflow-hidden">
            <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Conversations
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <p className="p-3 text-sm text-slate-500">Loading...</p>
              ) : conversations.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">No conversations match these filters.</p>
              ) : (
                <ul>
                  {conversations.map((row) => {
                    const active = row.id === selectedId;
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={cn(
                            "w-full border-b px-3 py-2 text-left text-sm hover:bg-slate-50",
                            active ? "bg-slate-900 text-white hover:bg-slate-900" : "bg-white",
                          )}
                          onClick={() => setParam("conversation", String(row.id))}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">
                              {row.from_number} → {row.to_number}
                            </span>
                          </div>
                          <div className={cn("truncate text-xs", active ? "text-slate-300" : "text-slate-500")}>
                            {row.department || "—"} · {row.agent_id == null ? (row.agent_name ? `${row.agent_name} (deleted)` : "—") : (row.agent_name || `agent ${row.agent_id}`)}
                          </div>
                          <div className={cn("truncate text-xs", active ? "text-slate-300" : "text-slate-500")}>
                            {row.last_message_preview || "(no messages)"}
                          </div>
                          <div className={cn("text-xs", active ? "text-slate-400" : "text-slate-400")}>
                            {formatDate(row.updated_at)}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </PanelCard>
        }
      >
        <PanelCard className="flex h-full min-h-[20rem] flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
              Select a conversation.
            </div>
          ) : loadingThread && !conversation ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">Loading...</div>
          ) : !conversation ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
              Conversation not found.
            </div>
          ) : (
            <>
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium text-slate-900">
                  {conversation.from_number} → {conversation.to_number}
                </p>
                <p className="text-xs text-slate-500">
                  {conversation.department || "—"} · {conversation.agent_id == null ? (conversation.agent_name ? `${conversation.agent_name} (deleted)` : "—") : (conversation.agent_name || `agent ${conversation.agent_id}`)}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {(conversation.messages || []).map((message) => {
                    const outbound = message.direction === "outbound";
                    return (
                      <div key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                            outbound ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900",
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.body || "(empty)"}</p>
                          <p className={cn("mt-1 text-xs", outbound ? "text-slate-300" : "text-slate-500")}>
                            {outbound ? "Outbound" : "Inbound"} · {formatDate(message.created_at)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              </div>
            </>
          )}
        </PanelCard>
      </SplitPanelLayout>

      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? <p>{notice.message}</p> : null}
      />
    </div>
  );
}
