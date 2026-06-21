import { useCallback, useEffect, useState } from "react";
import { api, SystemParam } from "@/api/client";
import { Button, Label } from "@/components/ui/primitives";

export default function SettingsPage() {
  const [params, setParams] = useState<SystemParam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
              } catch {
                setError("Could not save settings");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
