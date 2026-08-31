import { useCallback, useEffect, useState } from "react";
import { api, SystemParam, userFacingApiError } from "@/api/client";
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications";
import { NoticeModal } from "@/components/ui/modal";
import { Button, Label, Switch } from "@/components/ui/primitives";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<SystemParam[]>("/system-params");
    setParams(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const updateValue = (key: string, value: string) => {
    setParams((prev) => prev.map((param) => (param.key === key ? { ...param, value } : param)));
    setSaved(false);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-slate-600">
        System parameters stored in the database. <code>CLAUDE_CLI_ARGS</code> is a JSON array of extra flags passed to
        the Claude CLI on every agent run. Timeout grace values control when SIGTERM and SIGKILL are sent after an
        agent&apos;s configured run timeout.
      </p>

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
          {params.map((param) => (
            <div key={param.key} className="rounded-lg border bg-white p-4">
              <Label htmlFor={param.key}>{param.key}</Label>
              {param.description ? <p className="mt-1 text-sm text-slate-600">{param.description}</p> : null}
              <textarea
                id={param.key}
                className="mt-2 min-h-[5rem] w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                value={param.value}
                onChange={(e) => updateValue(param.key, e.target.value)}
              />
            </div>
          ))}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {saved ? <p className="text-sm text-green-700">Saved.</p> : null}

          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              setSaved(false);
              try {
                const res = await api.put<SystemParam[]>("/system-params", {
                  items: params.map(({ key, value, description }) => ({ key, value, description })),
                });
                setParams(res.data);
                setSaved(true);
                setNotice({ title: "Settings saved", message: "System parameters were updated." });
              } catch (err) {
                const message = userFacingApiError(err);
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
    </div>
  );
}
