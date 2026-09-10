import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Agent, api, userFacingApiError, Department } from "@/api/client";
import { ConfirmModal, Modal, NoticeModal } from "@/components/ui/modal";
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
  const [provisionTarget, setProvisionTarget] = useState<Department | null>(null);
  const [unprovisionTarget, setUnprovisionTarget] = useState<Department | null>(null);
  const [emailProvisionTarget, setEmailProvisionTarget] = useState<Department | null>(null);
  const [emailUnprovisionTarget, setEmailUnprovisionTarget] = useState<Department | null>(null);
  const [fromNumber, setFromNumber] = useState("");
  const [watiEndpoint, setWatiEndpoint] = useState("");
  const [watiToken, setWatiToken] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: ReactNode } | null>(null);
  const [creating, setCreating] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [unprovisioning, setUnprovisioning] = useState(false);
  const [emailProvisioning, setEmailProvisioning] = useState(false);
  const [emailUnprovisioning, setEmailUnprovisioning] = useState(false);

  const sortAccessors = useMemo(
    () => ({
      name: (row: Department) => row.name,
      created_at: (row: Department) => row.created_at ?? "",
      whatsapp: (row: Department) => row.whatsapp_from_number ?? "",
      email: (row: Department) => row.email_address ?? "",
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

  const openProvision = (department: Department) => {
    setFromNumber("");
    setWatiEndpoint("");
    setWatiToken("");
    setError(null);
    setProvisionTarget(department);
  };

  const openEmailProvision = (department: Department) => {
    setEmailAddress("");
    setAppPassword("");
    setError(null);
    setEmailProvisionTarget(department);
  };

  const replaceDepartment = (updated: Department) => {
    setDepartments((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Departments</h1>
      <p className="text-sm text-slate-600">
        Creating a department adds <code>{`{name}/input/`}</code> under the workspace. Agents live in{" "}
        <code>{`{department}/{agent}/`}</code>. Deleting a department does not remove workspace files.
      </p>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setCreating(true);
          try {
            const created = await api.post<Department>("/departments", { name });
            setName("");
            setDepartments((rows) => [...rows, created.data]);
            setNotice({ title: "Department created", message: `Created ${created.data.name}.` });
          } catch (err) {
            const message = userFacingApiError(err);
            setError(message);
            setNotice({ title: "Could not create department", message });
          } finally {
            setCreating(false);
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
        <Button type="submit" disabled={!name.trim() || creating}>
          {creating ? "Creating..." : "Create"}
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
                  <SortableTh
                    label="WhatsApp"
                    sortKey="whatsapp"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="Email"
                    sortKey="email"
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
                    <td className="px-4 py-2">{department.whatsapp_from_number || "—"}</td>
                    <td className="px-4 py-2">{department.email_address || "—"}</td>
                    <td className="px-4 py-2">{agentCount(department.name)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        {department.wati_configured ? (
                          <Button variant="outline" onClick={() => setUnprovisionTarget(department)}>
                            Unprovision WhatsApp
                          </Button>
                        ) : (
                          <Button variant="outline" onClick={() => openProvision(department)}>
                            Provision WhatsApp
                          </Button>
                        )}
                        {department.email_configured ? (
                          <Button variant="outline" onClick={() => setEmailUnprovisionTarget(department)}>
                            Unprovision Email
                          </Button>
                        ) : (
                          <Button variant="outline" onClick={() => openEmailProvision(department)}>
                            Provision Email
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          disabled={agentCount(department.name) > 0}
                          onClick={() => setDeleteTarget(department)}
                        >
                          Delete
                        </Button>
                      </div>
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
                  <DataCardField label="WhatsApp">{department.whatsapp_from_number || "—"}</DataCardField>
                  <DataCardField label="Email">{department.email_address || "—"}</DataCardField>
                  <DataCardField label="Agents">{agentCount(department.name)}</DataCardField>
                </dl>
                <DataCardActions>
                  {department.wati_configured ? (
                    <Button variant="outline" onClick={() => setUnprovisionTarget(department)}>
                      Unprovision WhatsApp
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => openProvision(department)}>
                      Provision WhatsApp
                    </Button>
                  )}
                  {department.email_configured ? (
                    <Button variant="outline" onClick={() => setEmailUnprovisionTarget(department)}>
                      Unprovision Email
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => openEmailProvision(department)}>
                      Provision Email
                    </Button>
                  )}
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

      <Modal
        open={!!provisionTarget}
        onOpenChange={(open) => {
          if (provisioning && !open) return;
          if (!open) setProvisionTarget(null);
        }}
        title="Provision WhatsApp"
      >
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!provisionTarget) return;
            setError(null);
            setProvisioning(true);
            try {
              const updated = await api.post<Department>(`/departments/${provisionTarget.id}/whatsapp`, {
                from_number: fromNumber,
                wati_api_endpoint: watiEndpoint,
                wati_api_token: watiToken,
              });
              replaceDepartment(updated.data);
              setProvisionTarget(null);
              setNotice({
                title: "WhatsApp provisioned",
                message: (
                  <div className="space-y-2">
                    <p>
                      Paste this webhook URL in WATI (Connectors → Webhooks) and enable the message-received event
                      only.
                    </p>
                    <p className="break-all rounded border bg-slate-50 p-2 font-mono text-xs text-slate-800">
                      {updated.data.wati_webhook_url}
                    </p>
                  </div>
                ),
              });
            } catch (err) {
              const message = userFacingApiError(err);
              setError(message);
              setNotice({ title: "Could not provision WhatsApp", message });
            } finally {
              setProvisioning(false);
            }
          }}
        >
          <p className="text-sm text-slate-600">
            Provision WhatsApp for <strong>{provisionTarget?.name}</strong>.
          </p>
          <div>
            <Label htmlFor="whatsapp-from-number">Israeli mobile number</Label>
            <Input
              id="whatsapp-from-number"
              placeholder="0501234567"
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="wati-endpoint">WATI API endpoint</Label>
            <Input
              id="wati-endpoint"
              placeholder="https://live-server-xxxx.wati.io"
              value={watiEndpoint}
              onChange={(e) => setWatiEndpoint(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="wati-token">WATI API token</Label>
            <Input
              id="wati-token"
              type="password"
              autoComplete="off"
              value={watiToken}
              onChange={(e) => setWatiToken(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={provisioning} onClick={() => setProvisionTarget(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={provisioning || !fromNumber.trim() || !watiEndpoint.trim() || !watiToken.trim()}
            >
              {provisioning ? "Provisioning..." : "Provision"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!unprovisionTarget}
        onOpenChange={(open) => !open && !unprovisioning && setUnprovisionTarget(null)}
        title="Unprovision WhatsApp?"
        confirmLabel="Unprovision"
        destructive
        busy={unprovisioning}
        description={
          unprovisionTarget ? (
            <p>
              Remove WhatsApp from <strong>{unprovisionTarget.name}</strong>? The webhook URL will stop working.
              Conversation history is kept.
            </p>
          ) : null
        }
        onConfirm={async () => {
          if (!unprovisionTarget) return;
          const target = unprovisionTarget;
          setUnprovisioning(true);
          try {
            const updated = await api.delete<Department>(`/departments/${target.id}/whatsapp`);
            setUnprovisionTarget(null);
            replaceDepartment(updated.data);
            setNotice({ title: "WhatsApp unprovisioned", message: `Removed WhatsApp from ${target.name}.` });
          } catch (err) {
            const message = userFacingApiError(err);
            setUnprovisionTarget(null);
            setError(message);
            setNotice({ title: "Could not unprovision WhatsApp", message });
          } finally {
            setUnprovisioning(false);
          }
        }}
      />

      <Modal
        open={!!emailProvisionTarget}
        onOpenChange={(open) => {
          if (emailProvisioning && !open) return;
          if (!open) setEmailProvisionTarget(null);
        }}
        title="Provision Email"
      >
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!emailProvisionTarget) return;
            setError(null);
            setEmailProvisioning(true);
            try {
              const updated = await api.post<Department>(`/departments/${emailProvisionTarget.id}/email`, {
                email_address: emailAddress,
                app_password: appPassword,
              });
              replaceDepartment(updated.data);
              setEmailProvisionTarget(null);
              setNotice({
                title: "Email provisioned",
                message: `Agents in ${updated.data.name} can send from ${updated.data.email_address} using a Google app password.`,
              });
            } catch (err) {
              const message = userFacingApiError(err);
              setError(message);
              setNotice({ title: "Could not provision email", message });
            } finally {
              setEmailProvisioning(false);
            }
          }}
        >
          <p className="text-sm text-slate-600">
            Provision Gmail sending for <strong>{emailProvisionTarget?.name}</strong>. Use a Google app password, not
            the account password.
          </p>
          <div>
            <Label htmlFor="department-email-address">Gmail address</Label>
            <Input
              id="department-email-address"
              type="email"
              placeholder="agent@gmail.com"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="department-app-password">Google app password</Label>
            <Input
              id="department-app-password"
              type="password"
              autoComplete="off"
              placeholder="xxxx xxxx xxxx xxxx"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={emailProvisioning}
              onClick={() => setEmailProvisionTarget(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={emailProvisioning || !emailAddress.trim() || !appPassword.trim()}>
              {emailProvisioning ? "Provisioning..." : "Provision"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!emailUnprovisionTarget}
        onOpenChange={(open) => !open && !emailUnprovisioning && setEmailUnprovisionTarget(null)}
        title="Unprovision email?"
        confirmLabel="Unprovision"
        destructive
        busy={emailUnprovisioning}
        description={
          emailUnprovisionTarget ? (
            <p>
              Remove email sending from <strong>{emailUnprovisionTarget.name}</strong>? Queued and sent messages are
              kept.
            </p>
          ) : null
        }
        onConfirm={async () => {
          if (!emailUnprovisionTarget) return;
          const target = emailUnprovisionTarget;
          setEmailUnprovisioning(true);
          try {
            const updated = await api.delete<Department>(`/departments/${target.id}/email`);
            setEmailUnprovisionTarget(null);
            replaceDepartment(updated.data);
            setNotice({ title: "Email unprovisioned", message: `Removed email from ${target.name}.` });
          } catch (err) {
            const message = userFacingApiError(err);
            setEmailUnprovisionTarget(null);
            setError(message);
            setNotice({ title: "Could not unprovision email", message });
          } finally {
            setEmailUnprovisioning(false);
          }
        }}
      />

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
          const target = deleteTarget;
          try {
            await api.delete(`/departments/${target.id}`);
            setDeleteTarget(null);
            setDepartments((rows) => rows.filter((row) => row.id !== target.id));
            setNotice({ title: "Department deleted", message: `Deleted ${target.name}.` });
          } catch (err) {
            const message = userFacingApiError(err);
            setDeleteTarget(null);
            setError(message);
            setNotice({ title: "Could not delete department", message });
          }
        }}
      />
      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? (typeof notice.message === "string" ? <p>{notice.message}</p> : notice.message) : null}
      />
    </div>
  );
}
