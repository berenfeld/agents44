import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Agent,
  api,
  EmailContentType,
  EmailMessage,
  EmailSendingStatus,
  EmailWritePayload,
  userFacingApiError,
} from "@/api/client";
import { Modal, NoticeModal } from "@/components/ui/modal";
import { SortableTh } from "@/components/ui/sortable-table";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { useTableSort } from "@/hooks/useTableSort";
import { cn, formatDate } from "@/lib/utils";
import {
  DataCard,
  DataCardActions,
  DataCardField,
  DataCardTitle,
  DesktopTableShell,
  MobileCardList,
} from "@/components/ui/data-card";

const selectClassName =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 sm:w-auto sm:min-w-[12rem]";

const STATUS_STYLES: Record<EmailSendingStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-800",
  fail: "border-red-200 bg-red-50 text-red-800",
  canceled: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatAddressList(addresses: string[] | null | undefined) {
  if (!addresses || addresses.length === 0) return "—";
  return addresses.join(", ");
}

function previewMessage(message: string) {
  const text = (message || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "...";
  if (text.length <= 80) return `${text}...`;
  return `${text.slice(0, 80)}...`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailSrcDoc(message: string, contentType: EmailContentType) {
  const style =
    "body{font-family:system-ui,sans-serif;margin:16px;color:#0f172a;line-height:1.5;background:#fff;}img{max-width:100%;}a{color:#1d4ed8;}pre{white-space:pre-wrap;word-break:break-word;}";
  if (contentType === "plain") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${style}</style></head><body><pre>${escapeHtml(message || "")}</pre></body></html>`;
  }
  if (/<html[\s>]/i.test(message || "")) {
    return message;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${message || ""}</body></html>`;
}

function StatusBadge({ status }: { status: EmailSendingStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? STATUS_STYLES.pending,
      )}
    >
      {status}
    </span>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type EditForm = {
  from_email: string;
  subject: string;
  recipients: string;
  cc: string;
  bcc: string;
  message: string;
  content_type: EmailContentType;
  sending_status: EmailSendingStatus;
};

function toEditForm(row: EmailMessage): EditForm {
  return {
    from_email: row.from_email,
    subject: row.subject,
    recipients: (row.recipients || []).join(", "),
    cc: (row.cc || []).join(", "),
    bcc: (row.bcc || []).join(", "),
    message: row.message,
    content_type: row.content_type,
    sending_status: row.sending_status,
  };
}

function splitAddresses(raw: string) {
  return raw
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function EmailsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent_id") ?? "";
  const addressFilter = searchParams.get("address") ?? "";
  const subjectFilter = searchParams.get("subject") ?? "";
  const contentFilter = searchParams.get("content") ?? "";

  const [agents, setAgents] = useState<Agent[]>([]);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addressDraft, setAddressDraft] = useState(addressFilter);
  const [subjectDraft, setSubjectDraft] = useState(subjectFilter);
  const [contentDraft, setContentDraft] = useState(contentFilter);
  const [preview, setPreview] = useState<EmailMessage | null>(null);
  const [editTarget, setEditTarget] = useState<EmailMessage | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: ReactNode } | null>(null);

  const sortAccessors = useMemo(
    () => ({
      id: (row: EmailMessage) => row.id,
      created_at: (row: EmailMessage) => row.created_at ?? "",
      agent_name: (row: EmailMessage) => row.agent_name ?? "",
      from_email: (row: EmailMessage) => row.from_email,
      subject: (row: EmailMessage) => row.subject,
      sending_status: (row: EmailMessage) => row.sending_status,
    }),
    [],
  );
  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(emails, sortAccessors);

  useEffect(() => {
    setAddressDraft(addressFilter);
    setSubjectDraft(subjectFilter);
    setContentDraft(contentFilter);
  }, [addressFilter, contentFilter, subjectFilter]);

  const loadAgents = useCallback(async () => {
    const res = await api.get<Agent[]>("/agents");
    setAgents(res.data);
  }, []);

  const loadEmails = useCallback(async () => {
    const params = new URLSearchParams();
    if (agentFilter) params.set("agent_id", agentFilter);
    if (addressFilter) params.set("address", addressFilter);
    if (subjectFilter) params.set("subject", subjectFilter);
    if (contentFilter) params.set("content", contentFilter);
    const query = params.toString();
    const res = await api.get<EmailMessage[]>(`/emails${query ? `?${query}` : ""}`);
    setEmails(res.data);
  }, [addressFilter, agentFilter, contentFilter, subjectFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadAgents();
        await loadEmails();
      } catch (err) {
        if (!cancelled) {
          setNotice({ title: "Could not load emails", message: userFacingApiError(err) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAgents, loadEmails]);

  const applyTextFilters = () => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (addressDraft.trim()) params.set("address", addressDraft.trim());
      else params.delete("address");
      if (subjectDraft.trim()) params.set("subject", subjectDraft.trim());
      else params.delete("subject");
      if (contentDraft.trim()) params.set("content", contentDraft.trim());
      else params.delete("content");
      return params;
    });
  };

  const replaceEmail = (updated: EmailMessage) => {
    setEmails((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    setPreview((current) => (current?.id === updated.id ? updated : current));
  };

  const patchEmail = async (id: number, payload: EmailWritePayload, title: string, success: string) => {
    const updated = await api.patch<EmailMessage>(`/emails/${id}`, payload);
    replaceEmail(updated.data);
    setNotice({ title, message: success });
    return updated.data;
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadEmails();
    } catch (err) {
      setNotice({ title: "Could not refresh emails", message: userFacingApiError(err) });
    } finally {
      setRefreshing(false);
    }
  };

  const openEdit = (row: EmailMessage) => {
    setEditTarget(row);
    setEditForm(toEditForm(row));
  };

  const saveEdit = async () => {
    if (!editTarget || !editForm) return;
    setSaving(true);
    try {
      await patchEmail(
        editTarget.id,
        {
          from_email: editForm.from_email,
          subject: editForm.subject,
          recipients: splitAddresses(editForm.recipients),
          cc: splitAddresses(editForm.cc),
          bcc: splitAddresses(editForm.bcc),
          message: editForm.message,
          content_type: editForm.content_type,
          sending_status: editForm.sending_status,
        },
        "Email updated",
        `Saved email #${editTarget.id}.`,
      );
      setEditTarget(null);
      setEditForm(null);
    } catch (err) {
      setNotice({ title: "Could not update email", message: userFacingApiError(err) });
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row: EmailMessage, sending_status: EmailSendingStatus) => {
    setStatusBusyId(row.id);
    const title = sending_status === "canceled" ? "Email canceled" : "Email queued";
    const success =
      sending_status === "canceled" ? `Canceled email #${row.id}.` : `Set email #${row.id} to pending.`;
    try {
      await patchEmail(row.id, { sending_status }, title, success);
    } catch (err) {
      setNotice({
        title: sending_status === "canceled" ? "Could not cancel email" : "Could not queue email",
        message: userFacingApiError(err),
      });
    } finally {
      setStatusBusyId(null);
    }
  };

  const rowActions = (row: EmailMessage) => (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => openEdit(row)}>
        Edit
      </Button>
      {row.sending_status === "pending" ? (
        <Button
          variant="outline"
          disabled={statusBusyId === row.id}
          onClick={() => void setStatus(row, "canceled")}
        >
          {statusBusyId === row.id ? "Canceling..." : "Cancel"}
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={statusBusyId === row.id}
          onClick={() => void setStatus(row, "pending")}
        >
          {statusBusyId === row.id ? "Queueing..." : "Send again"}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Emails"
        filters={
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            <Label htmlFor="email-agent" className="sr-only">
              Agent
            </Label>
            <select
              id="email-agent"
              aria-label="Agent"
              className={selectClassName}
              value={agentFilter}
              onChange={(event) => {
                const next = event.target.value;
                setSearchParams((current) => {
                  const params = new URLSearchParams(current);
                  if (next) params.set("agent_id", next);
                  else params.delete("agent_id");
                  return params;
                });
              }}
            >
              <option value="">All agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <Input
              id="email-address"
              aria-label="Address filter"
              placeholder="Address"
              className="sm:w-40"
              value={addressDraft}
              onChange={(event) => setAddressDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyTextFilters();
              }}
            />
            <Input
              id="email-subject"
              aria-label="Subject filter"
              placeholder="Subject"
              className="sm:w-40"
              value={subjectDraft}
              onChange={(event) => setSubjectDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyTextFilters();
              }}
            />
            <Input
              id="email-content"
              aria-label="Content filter"
              placeholder="Content"
              className="sm:w-40"
              value={contentDraft}
              onChange={(event) => setContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyTextFilters();
              }}
            />
            <Button type="button" variant="outline" onClick={applyTextFilters}>
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

      {loading ? (
        <p>Loading...</p>
      ) : emails.length === 0 ? (
        <p className="text-sm text-slate-500">No emails match these filters.</p>
      ) : (
        <>
          <DesktopTableShell>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <SortableTh label="ID" sortKey="id" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh
                    label="Created"
                    sortKey="created_at"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="Agent"
                    sortKey="agent_name"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="From"
                    sortKey="from_email"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-2">To</th>
                  <SortableTh
                    label="Subject"
                    sortKey="subject"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-2">Message</th>
                  <SortableTh
                    label="Status"
                    sortKey="sending_status"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="px-4 py-2">{row.id}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-2">{row.agent_id == null ? (row.agent_name ? `${row.agent_name} (deleted)` : "—") : (row.agent_name || `agent ${row.agent_id}`)}</td>
                    <td className="px-4 py-2">{row.from_email}</td>
                    <td className="max-w-[12rem] px-4 py-2 break-words">{formatAddressList(row.recipients)}</td>
                    <td className="max-w-[14rem] px-4 py-2 break-words">{row.subject}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        className="max-w-[16rem] text-left text-sky-700 underline-offset-2 hover:underline"
                        onClick={() => setPreview(row)}
                      >
                        {previewMessage(row.message)}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={row.sending_status} />
                      {row.error_message ? (
                        <p className="mt-1 max-w-[12rem] text-xs text-red-600">{row.error_message}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">{rowActions(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTableShell>

          <MobileCardList>
            {sorted.map((row) => (
              <DataCard key={row.id}>
                <DataCardTitle>
                  #{row.id} · {row.subject || "(no subject)"}
                </DataCardTitle>
                <dl>
                  <DataCardField label="Created">{formatDate(row.created_at)}</DataCardField>
                  <DataCardField label="Agent">{row.agent_id == null ? (row.agent_name ? `${row.agent_name} (deleted)` : "—") : (row.agent_name || `agent ${row.agent_id}`)}</DataCardField>
                  <DataCardField label="From">{row.from_email}</DataCardField>
                  <DataCardField label="To">{formatAddressList(row.recipients)}</DataCardField>
                  <DataCardField label="Cc">{formatAddressList(row.cc)}</DataCardField>
                  <DataCardField label="Bcc">{formatAddressList(row.bcc)}</DataCardField>
                  <DataCardField label="Status">
                    <StatusBadge status={row.sending_status} />
                  </DataCardField>
                  <DataCardField label="Message">
                    <button
                      type="button"
                      className="text-left text-sky-700 underline-offset-2 hover:underline"
                      onClick={() => setPreview(row)}
                    >
                      {previewMessage(row.message)}
                    </button>
                  </DataCardField>
                </dl>
                <DataCardActions>{rowActions(row)}</DataCardActions>
              </DataCard>
            ))}
          </MobileCardList>
        </>
      )}

      <Modal
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        title={preview?.subject || "Email"}
        size="large"
      >
        {preview ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="text-sm text-slate-600">
              <p>
                From {preview.from_email} · To {formatAddressList(preview.recipients)}
              </p>
              {preview.cc.length > 0 ? <p>Cc {formatAddressList(preview.cc)}</p> : null}
              {preview.bcc.length > 0 ? <p>Bcc {formatAddressList(preview.bcc)}</p> : null}
            </div>
            <iframe
              title="Email message"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={emailSrcDoc(preview.message, preview.content_type)}
              className="h-[60vh] w-full rounded border bg-white"
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!editTarget}
        onOpenChange={(open) => {
          if (saving && !open) return;
          if (!open) {
            setEditTarget(null);
            setEditForm(null);
          }
        }}
        title={editTarget ? `Edit email #${editTarget.id}` : "Edit email"}
        size="large"
      >
        {editForm ? (
          <form
            className="space-y-3 overflow-y-auto"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit();
            }}
          >
            <div>
              <Label htmlFor="edit-from">From</Label>
              <Input
                id="edit-from"
                value={editForm.from_email}
                onChange={(event) => setEditForm({ ...editForm, from_email: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-subject">Subject</Label>
              <Input
                id="edit-subject"
                value={editForm.subject}
                onChange={(event) => setEditForm({ ...editForm, subject: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-to">Recipients</Label>
              <Input
                id="edit-to"
                value={editForm.recipients}
                onChange={(event) => setEditForm({ ...editForm, recipients: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-cc">Cc</Label>
              <Input
                id="edit-cc"
                value={editForm.cc}
                onChange={(event) => setEditForm({ ...editForm, cc: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-bcc">Bcc</Label>
              <Input
                id="edit-bcc"
                value={editForm.bcc}
                onChange={(event) => setEditForm({ ...editForm, bcc: event.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-content-type">Content type</Label>
                <select
                  id="edit-content-type"
                  className={selectClassName}
                  value={editForm.content_type}
                  onChange={(event) =>
                    setEditForm({ ...editForm, content_type: event.target.value as EmailContentType })
                  }
                >
                  <option value="html">html</option>
                  <option value="plain">plain</option>
                </select>
              </div>
              <div>
                <Label htmlFor="edit-status">Sending status</Label>
                <select
                  id="edit-status"
                  className={selectClassName}
                  value={editForm.sending_status}
                  onChange={(event) =>
                    setEditForm({ ...editForm, sending_status: event.target.value as EmailSendingStatus })
                  }
                >
                  <option value="pending">pending</option>
                  <option value="sent">sent</option>
                  <option value="fail">fail</option>
                  <option value="canceled">canceled</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="edit-message">Message</Label>
              <Textarea
                id="edit-message"
                rows={12}
                value={editForm.message}
                onChange={(event) => setEditForm({ ...editForm, message: event.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditTarget(null);
                  setEditForm(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? (typeof notice.message === "string" ? <p>{notice.message}</p> : notice.message) : null}
      />
    </div>
  );
}
