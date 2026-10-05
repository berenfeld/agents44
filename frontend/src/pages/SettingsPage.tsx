import { useCallback, useEffect, useMemo, useState } from "react";
import { AllowedEmail, api, SystemParam, userFacingApiError } from "@/api/client";
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications";
import { ConfirmModal, NoticeModal } from "@/components/ui/modal";
import { Button, Input, Label, Switch } from "@/components/ui/primitives";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MODEL_PARAM_KEYS = new Set(["MODEL_PRICING", "SUPPORTED_MODELS"]);

type ModelRow = {
  id: string;
  inputPerMillion: string;
  cacheReadPerMillion: string;
  outputPerMillion: string;
};

type PricingMap = Record<
  string,
  {
    input_per_million?: number;
    cache_read_per_million?: number;
    output_per_million?: number;
  }
>;

function formatParamValue(key: string, value: string): string {
  if (!MODEL_PARAM_KEYS.has(key)) {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Keep the raw value so the operator can fix invalid JSON.
  }
  return value;
}

function withFormattedParamValues(rows: SystemParam[]): SystemParam[] {
  return rows.map((param) => ({
    ...param,
    value: formatParamValue(param.key, param.value),
  }));
}

function parseSupportedModels(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // fall through to CSV
  }
  return trimmed
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePricing(raw: string): PricingMap {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PricingMap;
    }
  } catch {
    // empty
  }
  return {};
}

function modelRowsFromParams(params: SystemParam[]): ModelRow[] {
  const supported = params.find((p) => p.key === "SUPPORTED_MODELS");
  const pricingParam = params.find((p) => p.key === "MODEL_PRICING");
  const models = parseSupportedModels(supported?.value || "");
  const pricing = parsePricing(pricingParam?.value || "");
  const ids = [...models];
  for (const key of Object.keys(pricing).sort()) {
    if (!ids.includes(key)) {
      ids.push(key);
    }
  }
  return ids.map((id) => {
    const entry = pricing[id] || {};
    return {
      id,
      inputPerMillion:
        entry.input_per_million === undefined || entry.input_per_million === null
          ? ""
          : String(entry.input_per_million),
      cacheReadPerMillion:
        entry.cache_read_per_million === undefined || entry.cache_read_per_million === null
          ? ""
          : String(entry.cache_read_per_million),
      outputPerMillion:
        entry.output_per_million === undefined || entry.output_per_million === null
          ? ""
          : String(entry.output_per_million),
    };
  });
}

function applyModelRowsToParams(params: SystemParam[], rows: ModelRow[]): SystemParam[] {
  const models = rows.map((row) => row.id.trim()).filter(Boolean);
  const uniqueModels: string[] = [];
  for (const model of models) {
    if (!uniqueModels.includes(model)) {
      uniqueModels.push(model);
    }
  }
  const pricing: PricingMap = {};
  for (const row of rows) {
    const id = row.id.trim();
    if (!id) {
      continue;
    }
    const input = Number(row.inputPerMillion);
    const output = Number(row.outputPerMillion);
    const cacheRead = Number(row.cacheReadPerMillion);
    const entry: PricingMap[string] = {
      input_per_million: Number.isFinite(input) ? input : 0,
      output_per_million: Number.isFinite(output) ? output : 0,
    };
    if (row.cacheReadPerMillion.trim() !== "" && Number.isFinite(cacheRead)) {
      entry.cache_read_per_million = cacheRead;
    }
    pricing[id] = entry;
  }
  const supportedValue = JSON.stringify(uniqueModels, null, 2);
  const pricingValue = JSON.stringify(pricing, null, 2);
  let next = params.map((param) => {
    if (param.key === "SUPPORTED_MODELS") {
      return { ...param, value: supportedValue };
    }
    if (param.key === "MODEL_PRICING") {
      return { ...param, value: pricingValue };
    }
    return param;
  });
  if (!next.some((p) => p.key === "SUPPORTED_MODELS")) {
    next = [
      ...next,
      {
        id: 0,
        key: "SUPPORTED_MODELS",
        value: supportedValue,
        description: "Provider-prefixed LiteLLM model ids shown in agent/chat selects.",
      },
    ];
  }
  if (!next.some((p) => p.key === "MODEL_PRICING")) {
    next = [
      ...next,
      {
        id: 0,
        key: "MODEL_PRICING",
        value: pricingValue,
        description: "USD per 1M tokens by provider-prefixed model id.",
      },
    ];
  }
  return next;
}

function desktopNotificationStatusText(args: {
  supported: boolean;
  permission: string;
  enabled: boolean;
  busy: boolean;
}): string {
  if (!args.supported) {
    return "This browser does not support desktop notifications.";
  }
  if (args.busy) {
    return args.enabled ? "Turning off..." : "Enabling...";
  }
  if (args.permission === "denied") {
    return "Blocked by the browser. Allow notifications for this site, then enable again.";
  }
  if (args.enabled) {
    return "On. You will get a desktop alert when an agent starts or finishes. Keep this tab open.";
  }
  return "Off. Enable to get a desktop alert when an agent starts or finishes.";
}

export default function SettingsPage() {
  const notifications = useDesktopNotifications();
  const [params, setParams] = useState<SystemParam[]>([]);
  const [modelRows, setModelRows] = useState<ModelRow[]>([]);
  const [allowedEmails, setAllowedEmails] = useState<AllowedEmail[]>([]);
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingEmail, setAddingEmail] = useState(false);
  const [deletingEmail, setDeletingEmail] = useState<AllowedEmail | null>(null);
  const [deletingEmailBusy, setDeletingEmailBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [paramsRes, emailsRes] = await Promise.all([
      api.get<SystemParam[]>("/system-params"),
      api.get<AllowedEmail[]>("/allowed-emails"),
    ]);
    const formatted = withFormattedParamValues(paramsRes.data);
    setParams(formatted);
    setModelRows(modelRowsFromParams(formatted));
    setAllowedEmails(emailsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const updateValue = (key: string, value: string) => {
    setParams((prev) => prev.map((param) => (param.key === key ? { ...param, value } : param)));
    setSaved(false);
  };

  const updateModelRow = (index: number, patch: Partial<ModelRow>) => {
    setModelRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaved(false);
  };

  const otherParams = useMemo(
    () => params.filter((param) => !MODEL_PARAM_KEYS.has(param.key)),
    [params],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-slate-600">
        System parameters stored in the database (<code>system_params</code>). Put LLM provider API keys here —
        <code> GEMINI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>,{" "}
        <code>DASHSCOPE_API_KEY</code>, or any other <code>*_API_KEY</code>. Use the Models table to choose which
        models appear in selects and set USD cost per 1M tokens. Allowed emails are stored separately; only those
        addresses can sign in. Admin login is not restricted.
      </p>

      <div className="rounded-lg border bg-white p-4">
        <Label>Allowed emails</Label>
        <p className="mt-1 text-sm text-slate-600">
          Only these emails can sign in (Google today). If the list is empty, those logins are rejected. Admin login
          always works.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const email = newAllowedEmail.trim().toLowerCase();
            if (!EMAIL_RE.test(email)) {
              setError("Email address is invalid");
              setNotice({ title: "Could not allow email", message: "Email address is invalid" });
              return;
            }
            setAddingEmail(true);
            setError(null);
            try {
              const created = await api.post<AllowedEmail>("/allowed-emails", {
                email,
              });
              setNewAllowedEmail("");
              setAllowedEmails((rows) =>
                [...rows, created.data].sort((a, b) => a.email.localeCompare(b.email)),
              );
              setNotice({ title: "Email allowed", message: `${created.data.email} can sign in.` });
            } catch (err) {
              const message = userFacingApiError(err);
              setError(message);
              setNotice({ title: "Could not allow email", message });
            } finally {
              setAddingEmail(false);
            }
          }}
        >
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor="allowed-email">New email</Label>
            <Input
              id="allowed-email"
              type="text"
              inputMode="email"
              autoComplete="off"
              placeholder="name@company.com"
              value={newAllowedEmail}
              onChange={(e) => setNewAllowedEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!newAllowedEmail.trim() || addingEmail || loading}>
            {addingEmail ? "Adding..." : "Allow email"}
          </Button>
        </form>
        {loading ? (
          <p className="mt-3 text-sm text-slate-600">Loading emails...</p>
        ) : allowedEmails.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No emails allowed yet.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-md border">
            {allowedEmails.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="break-all font-mono">{row.email}</span>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deletingEmailBusy}
                  onClick={() => setDeletingEmail(row)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="desktop-notifications">Desktop notifications</Label>
            <p className="mt-1 text-sm text-slate-600">
              {desktopNotificationStatusText({
                supported: notifications.supported,
                permission: notifications.permission,
                enabled: notifications.enabled,
                busy: notifications.busy,
              })}
            </p>
          </div>
          <Switch
            id="desktop-notifications"
            checked={notifications.enabled}
            disabled={notifications.busy || !notifications.supported}
            aria-busy={notifications.busy}
            onCheckedChange={(value) => {
              if (value) {
                void notifications.enable();
                return;
              }
              void notifications.disable();
            }}
          />
        </div>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4">
            <Label>Models and pricing</Label>
            <p className="mt-1 text-sm text-slate-600">
              Provider-prefixed LiteLLM ids (e.g. <code>openai/gpt-6-luna</code>,{" "}
              <code>gemini/gemini-3.8-flash</code>). Costs are USD per 1M tokens for run estimates. Cached input is
              optional. Adding a row updates both the model allowlist and pricing.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-600">
                    <th className="px-2 py-2 font-medium">Model id</th>
                    <th className="px-2 py-2 font-medium">Input $/1M</th>
                    <th className="px-2 py-2 font-medium">Cached $/1M</th>
                    <th className="px-2 py-2 font-medium">Output $/1M</th>
                    <th className="px-2 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {modelRows.map((row, index) => (
                    <tr key={`model-${index}`} className="border-b align-top">
                      <td className="px-2 py-2">
                        <Input
                          className="min-w-[16rem] font-mono text-sm"
                          value={row.id}
                          placeholder="provider/model-id"
                          onChange={(e) => updateModelRow(index, { id: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          className="w-28 font-mono text-sm"
                          inputMode="decimal"
                          value={row.inputPerMillion}
                          placeholder="0"
                          onChange={(e) => updateModelRow(index, { inputPerMillion: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          className="w-28 font-mono text-sm"
                          inputMode="decimal"
                          value={row.cacheReadPerMillion}
                          placeholder="—"
                          onChange={(e) => updateModelRow(index, { cacheReadPerMillion: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          className="w-28 font-mono text-sm"
                          inputMode="decimal"
                          value={row.outputPerMillion}
                          placeholder="0"
                          onChange={(e) => updateModelRow(index, { outputPerMillion: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => {
                            setModelRows((prev) => prev.filter((_, i) => i !== index));
                            setSaved(false);
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setModelRows((prev) => [
                    ...prev,
                    { id: "", inputPerMillion: "", cacheReadPerMillion: "", outputPerMillion: "" },
                  ]);
                  setSaved(false);
                }}
              >
                Add model
              </Button>
            </div>
          </div>

          {otherParams.map((param) => {
            const isApiKey = param.key.endsWith("_API_KEY");
            return (
              <div key={param.key} className="rounded-lg border bg-white p-4">
                <Label htmlFor={param.key}>{param.key}</Label>
                {param.description ? <p className="mt-1 text-sm text-slate-600">{param.description}</p> : null}
                {isApiKey ? (
                  <Input
                    id={param.key}
                    type="password"
                    autoComplete="off"
                    className="mt-2 w-full font-mono text-sm"
                    value={param.value}
                    onChange={(e) => updateValue(param.key, e.target.value)}
                  />
                ) : (
                  <textarea
                    id={param.key}
                    spellCheck={false}
                    className="mt-2 min-h-[5rem] w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                    value={param.value}
                    onChange={(e) => updateValue(param.key, e.target.value)}
                  />
                )}
              </div>
            );
          })}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {saved ? <p className="text-sm text-green-700">Saved.</p> : null}

          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              setSaved(false);
              try {
                const blank = modelRows.some((row) => !row.id.trim());
                if (blank) {
                  throw Object.assign(new Error("Every model row needs a model id"), { isAxiosError: false });
                }
                if (modelRows.every((row) => !row.id.trim())) {
                  throw Object.assign(new Error("Add at least one model"), { isAxiosError: false });
                }
                const merged = applyModelRowsToParams(params, modelRows);
                const res = await api.put<SystemParam[]>("/system-params", {
                  items: merged.map(({ key, value, description }) => ({ key, value, description })),
                });
                const formatted = withFormattedParamValues(res.data);
                setParams(formatted);
                setModelRows(modelRowsFromParams(formatted));
                setSaved(true);
                setNotice({ title: "Settings saved", message: "System parameters were updated." });
              } catch (err) {
                const message =
                  err instanceof Error && !(err as { isAxiosError?: boolean }).isAxiosError && err.message
                    ? err.message
                    : userFacingApiError(err);
                setError(message);
                setNotice({ title: "Could not save settings", message });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save settings"}
          </Button>
        </div>
      )}
      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? <p>{notice.message}</p> : null}
      />
      <ConfirmModal
        open={!!deletingEmail}
        onOpenChange={(open) => !open && !deletingEmailBusy && setDeletingEmail(null)}
        title="Remove allowed email?"
        confirmLabel={deletingEmailBusy ? "Removing..." : "Remove"}
        destructive
        busy={deletingEmailBusy}
        description={
          deletingEmail ? (
            <p>
              Remove <strong>{deletingEmail.email}</strong> from the allowlist? That account will no longer be able to
              sign in.
            </p>
          ) : null
        }
        onConfirm={async () => {
          if (!deletingEmail) {
            return;
          }
          setDeletingEmailBusy(true);
          setError(null);
          try {
            const removed = deletingEmail.email;
            await api.delete(`/allowed-emails/${deletingEmail.id}`);
            setAllowedEmails((rows) => rows.filter((row) => row.id !== deletingEmail.id));
            setDeletingEmail(null);
            setNotice({ title: "Email removed", message: `${removed} can no longer sign in.` });
          } catch (err) {
            const message = userFacingApiError(err);
            setError(message);
            setNotice({ title: "Could not remove email", message });
          } finally {
            setDeletingEmailBusy(false);
          }
        }}
      />
    </div>
  );
}
