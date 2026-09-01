import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Agent, api, ClaudeConversation, ClaudeMessage, userFacingApiError } from "@/api/client";
import { ConfirmModal, Modal, NoticeModal } from "@/components/ui/modal";
import { Button, Label, Textarea } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { cn, formatDate } from "@/lib/utils";

const markdownClassName =
  "text-sm leading-relaxed text-slate-900 [&_*]:text-slate-900 [&_a]:underline [&_code]:rounded [&_code]:border [&_code]:border-slate-200 [&_code]:bg-slate-50 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-2 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-50 [&_pre]:p-3 [&_pre]:text-slate-900 [&_table]:mb-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5";

const selectClassName =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 sm:w-auto sm:min-w-[14rem]";

function parseConversationId(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={cn("h-3.5 w-3.5 animate-spin", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function AssistantBody({ message }: { message: ClaudeMessage }) {
  if (message.status === "pending") {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" />
        Claude is responding...
      </p>
    );
  }
  if (message.status === "failed" && !message.content.trim()) {
    return <p className="text-sm text-red-600">{message.error_message || "Claude failed to reply"}</p>;
  }
  return (
    <div className="space-y-2">
      {message.content.trim() ? (
        <div className={markdownClassName}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-slate-500">(empty)</p>
      )}
      {message.status === "failed" && message.error_message ? (
        <p className="text-sm text-red-600">{message.error_message}</p>
      ) : null}
    </div>
  );
}

export default function ClaudePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = parseConversationId(searchParams.get("conversation"));
  const selectedIdRef = useRef(selectedId);
  const setSearchParamsRef = useRef(setSearchParams);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [tabs, setTabs] = useState<ClaudeConversation[]>([]);
  const [archived, setArchived] = useState<ClaudeConversation[]>([]);
  const [conversation, setConversation] = useState<ClaudeConversation | null>(null);
  const [agentId, setAgentId] = useState<number | "">("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [changingAgent, setChangingAgent] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ClaudeConversation | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    setSearchParamsRef.current = setSearchParams;
  }, [setSearchParams]);

  const setSelectedId = useCallback((id: number | null) => {
    if (selectedIdRef.current === id) return;
    selectedIdRef.current = id;
    setSearchParamsRef.current(
      (current) => {
        const params = new URLSearchParams(current);
        if (id) {
          params.set("conversation", String(id));
        } else {
          params.delete("conversation");
        }
        return params;
      },
      { replace: true },
    );
  }, []);

  const loadTabs = useCallback(async () => {
    const [agentsRes, tabsRes] = await Promise.all([
      api.get<Agent[]>("/agents"),
      api.get<ClaudeConversation[]>("/claude/conversations"),
    ]);
    setAgents(agentsRes.data);
    setTabs(tabsRes.data);
    setAgentId((current) => {
      if (current !== "" && agentsRes.data.some((agent) => agent.id === current)) {
        return current;
      }
      return agentsRes.data[0]?.id ?? "";
    });
    return { agents: agentsRes.data, tabs: tabsRes.data };
  }, []);

  const loadConversation = useCallback(async (id: number) => {
    const res = await api.get<ClaudeConversation>(`/claude/conversations/${id}`);
    if (selectedIdRef.current !== id) {
      return res.data;
    }
    setConversation(res.data);
    setAgentId(res.data.agent_id);
    setTabs((current) => {
      if (res.data.archived_at) {
        return current.filter((tab) => tab.id !== res.data.id);
      }
      const next = current.some((tab) => tab.id === res.data.id)
        ? current.map((tab) => (tab.id === res.data.id ? { ...tab, ...res.data, messages: undefined } : tab))
        : [...current, { ...res.data, messages: undefined }];
      return next;
    });
    return res.data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { tabs: nextTabs } = await loadTabs();
        if (cancelled) return;
        if (selectedIdRef.current == null && nextTabs[0]) {
          setSelectedId(nextTabs[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setNotice({ title: "Could not load conversations", message: userFacingApiError(err) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTabs, setSelectedId]);

  useEffect(() => {
    if (!selectedId) {
      setConversation(null);
      return;
    }
    let cancelled = false;
    loadConversation(selectedId).catch((err) => {
      if (cancelled || selectedIdRef.current !== selectedId) return;
      setConversation(null);
      setNotice({ title: "Could not load conversation", message: userFacingApiError(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [loadConversation, selectedId]);

  const busy = Boolean(conversation?.busy || conversation?.messages?.some((message) => message.status === "pending"));

  useEffect(() => {
    if (!selectedId || !busy) return;
    const timer = setInterval(() => {
      loadConversation(selectedId).catch(console.error);
    }, 1500);
    return () => clearInterval(timer);
  }, [busy, loadConversation, selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation?.messages, conversation?.busy]);

  const messages = conversation?.messages ?? [];
  const archivedConversation = Boolean(conversation?.archived_at);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === (typeof agentId === "number" ? agentId : -1)) ?? null,
    [agentId, agents],
  );
  const canSend =
    Boolean(conversation) &&
    !archivedConversation &&
    !busy &&
    !sending &&
    Boolean(prompt.trim()) &&
    Boolean(selectedAgent?.enabled);

  const createTab = async () => {
    if (agentId === "") {
      setNotice({ title: "Could not create conversation", message: "Select an agent first." });
      return;
    }
    setCreating(true);
    try {
      const res = await api.post<ClaudeConversation>("/claude/conversations", { agent_id: agentId });
      setTabs((current) => [...current, { ...res.data, messages: undefined }]);
      setConversation(res.data);
      setPrompt("");
      setSelectedId(res.data.id);
    } catch (err) {
      setNotice({ title: "Could not create conversation", message: userFacingApiError(err) });
    } finally {
      setCreating(false);
    }
  };

  const changeAgent = async (nextAgentId: number) => {
    setAgentId(nextAgentId);
    if (!conversation || conversation.archived_at) return;
    if (nextAgentId === conversation.agent_id) return;
    setChangingAgent(true);
    try {
      const res = await api.patch<ClaudeConversation>(`/claude/conversations/${conversation.id}`, {
        agent_id: nextAgentId,
      });
      setConversation(res.data);
      setTabs((current) => current.map((tab) => (tab.id === res.data.id ? { ...tab, ...res.data, messages: undefined } : tab)));
    } catch (err) {
      setAgentId(conversation.agent_id);
      setNotice({ title: "Could not change agent", message: userFacingApiError(err) });
    } finally {
      setChangingAgent(false);
    }
  };

  const sendPrompt = async () => {
    if (!conversation || !canSend) return;
    const content = prompt.trim();
    setSending(true);
    try {
      const res = await api.post<ClaudeConversation>(`/claude/conversations/${conversation.id}/messages`, { content });
      setPrompt("");
      setConversation(res.data);
      setTabs((current) => current.map((tab) => (tab.id === res.data.id ? { ...tab, ...res.data, messages: undefined } : tab)));
    } catch (err) {
      setNotice({ title: "Could not send prompt", message: userFacingApiError(err) });
    } finally {
      setSending(false);
    }
  };

  const stopReply = async () => {
    if (!conversation) return;
    setStopping(true);
    try {
      const res = await api.post<ClaudeConversation>(`/claude/conversations/${conversation.id}/stop`, {});
      setConversation(res.data);
    } catch (err) {
      setNotice({ title: "Could not stop Claude", message: userFacingApiError(err) });
    } finally {
      setStopping(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    setArchiving(true);
    try {
      await api.post(`/claude/conversations/${target.id}/archive`, {});
      const remaining = tabs.filter((tab) => tab.id !== target.id);
      setTabs(remaining);
      setArchiveTarget(null);
      if (conversation?.id === target.id) {
        setConversation(null);
        setSelectedId(remaining[0]?.id ?? null);
      }
      setNotice({ title: "Conversation archived", message: `"${target.title}" was hidden. It is still stored in the database.` });
    } catch (err) {
      setNotice({ title: "Could not archive conversation", message: userFacingApiError(err) });
    } finally {
      setArchiving(false);
    }
  };

  const openArchived = async () => {
    setArchivedOpen(true);
    setLoadingArchived(true);
    try {
      const res = await api.get<ClaudeConversation[]>("/claude/conversations", { params: { archived: true } });
      setArchived(res.data);
    } catch (err) {
      setArchivedOpen(false);
      setNotice({ title: "Could not load archived conversations", message: userFacingApiError(err) });
    } finally {
      setLoadingArchived(false);
    }
  };

  const restoreConversation = async (row: ClaudeConversation) => {
    setRestoringId(row.id);
    try {
      const res = await api.post<ClaudeConversation>(`/claude/conversations/${row.id}/unarchive`, {});
      setArchived((current) => current.filter((item) => item.id !== row.id));
      setTabs((current) => [...current, { ...res.data, messages: undefined }]);
      setConversation(res.data);
      setSelectedId(res.data.id);
      setArchivedOpen(false);
      setNotice({ title: "Conversation restored", message: `"${res.data.title}" is open again.` });
    } catch (err) {
      setNotice({ title: "Could not restore conversation", message: userFacingApiError(err) });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[32rem] flex-col gap-3">
      <PageHeader
        title="Claude"
        filters={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Label htmlFor="claude-agent" className="sr-only">
              Agent
            </Label>
            <select
              id="claude-agent"
              aria-label="Select agent"
              className={selectClassName}
              value={agentId}
              disabled={changingAgent || archivedConversation || agents.length === 0 || busy}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next)) {
                  void changeAgent(next);
                }
              }}
            >
              {agents.length === 0 ? <option value="">No agents</option> : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.enabled ? "" : " (disabled)"}
                  {` · ${agent.model}`}
                </option>
              ))}
            </select>
          </div>
        }
        actions={
          <Button variant="outline" onClick={() => void openArchived()}>
            Archived
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white">
        <div className="flex items-center gap-1 overflow-x-auto border-b bg-slate-50 px-2 py-1.5">
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            aria-label="New conversation"
            title="New conversation"
            disabled={creating || agentId === ""}
            onClick={() => void createTab()}
          >
            {creating ? <Spinner /> : <PlusIcon />}
          </button>
          {tabs.map((tab) => {
            const active = tab.id === selectedId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "flex max-w-[16rem] shrink-0 items-center rounded-md border",
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800",
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate px-3 py-1.5 text-left text-sm",
                    active ? "text-white" : "text-slate-800",
                  )}
                  onClick={() => setSelectedId(tab.id)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {tab.busy ? <Spinner className={active ? "text-white" : "text-slate-500"} /> : null}
                    <span className="truncate">{tab.title}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "mr-1 inline-flex h-6 w-6 items-center justify-center rounded",
                    active ? "text-slate-200 hover:bg-slate-700 hover:text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                  )}
                  aria-label={`Archive ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setArchiveTarget(tab);
                  }}
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">Loading...</div>
        ) : agents.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-600">
            <p>Create an agent before starting a Claude conversation.</p>
            <Link className="text-slate-900 underline" to="/agents">
              Go to Agents
            </Link>
          </div>
        ) : !conversation && selectedId ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">Loading...</div>
        ) : !conversation ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600">
            <p>Select an agent and open a conversation tab to chat with Claude.</p>
            <Button onClick={() => void createTab()} disabled={creating || agentId === ""}>
              {creating ? "Creating..." : "New conversation"}
            </Button>
          </div>
        ) : (
          <>
            <form
              className="border-b bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void sendPrompt();
              }}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Textarea
                  aria-label="Prompt"
                  rows={3}
                  placeholder={archivedConversation ? "Archived conversations are read-only" : "Write a prompt..."}
                  value={prompt}
                  disabled={sending || archivedConversation || !selectedAgent?.enabled}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (canSend) void sendPrompt();
                    }
                  }}
                />
                <div className="flex shrink-0 gap-2">
                  {busy ? (
                    <Button type="button" variant="destructive" disabled={stopping} onClick={() => void stopReply()}>
                      {stopping ? "Stopping..." : "Stop"}
                    </Button>
                  ) : (
                    <Button type="submit" disabled={!canSend}>
                      {sending ? "Sending..." : "Send"}
                    </Button>
                  )}
                </div>
              </div>
            </form>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {archivedConversation ? (
                <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                  <p>This conversation is archived. Restore it to send more prompts. Messages are still stored in the database.</p>
                  <Button
                    className="shrink-0"
                    disabled={restoringId === conversation.id}
                    onClick={() => void restoreConversation(conversation)}
                  >
                    {restoringId === conversation.id ? "Restoring..." : "Restore"}
                  </Button>
                </div>
              ) : null}
              {selectedAgent && !selectedAgent.enabled ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Agent {selectedAgent.name} is disabled. Enable it to send prompts.
                </div>
              ) : null}
              {messages.length === 0 ? (
                <p className="text-sm text-slate-500">Send a prompt to start the conversation.</p>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {message.role === "user" ? "Prompt" : "Claude"}
                    </div>
                    {message.role === "user" ? (
                      <div className="whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900">
                        {message.content}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 px-3 py-2">
                        <AssistantBody message={message} />
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (archiving && !open) return;
          if (!open) setArchiveTarget(null);
        }}
        title="Archive conversation?"
        confirmLabel={archiving ? "Archiving..." : "Archive"}
        destructive
        busy={archiving}
        description={
          archiveTarget ? (
            <p>
              Hide <strong>{archiveTarget.title}</strong> from the tab bar? The conversation and all messages stay in
              the database and can be restored from Archived.
            </p>
          ) : null
        }
        onConfirm={() => void confirmArchive()}
      />

      <Modal open={archivedOpen} onOpenChange={setArchivedOpen} title="Archived conversations" size="large">
        {loadingArchived ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : archived.length === 0 ? (
          <p className="text-sm text-slate-500">No archived conversations.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">Archived</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {archived.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.title}</td>
                    <td className="px-3 py-2">{row.agent_name ?? "-"}</td>
                    <td className="px-3 py-2">{formatDate(row.archived_at)}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="outline"
                        disabled={restoringId === row.id}
                        onClick={() => void restoreConversation(row)}
                      >
                        {restoringId === row.id ? "Restoring..." : "Restore"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? <p>{notice.message}</p> : null}
      />
    </div>
  );
}
