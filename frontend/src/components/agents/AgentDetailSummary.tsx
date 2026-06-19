import { Agent } from "@/api/client";
import { formatTimeoutSeconds } from "@/lib/timeout";

export function AgentDetailSummary({ agent }: { agent: Partial<Agent> }) {
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <dt className="font-medium">Name</dt>
      <dd>{agent.name || "-"}</dd>
      <dt className="font-medium">Department</dt>
      <dd>{agent.department || "-"}</dd>
      <dt className="font-medium">Model</dt>
      <dd>{agent.model || "-"}</dd>
      <dt className="font-medium">Cron</dt>
      <dd>{agent.crond || "(none)"}</dd>
      <dt className="font-medium">Timeout</dt>
      <dd>{agent.timeout_seconds != null ? formatTimeoutSeconds(agent.timeout_seconds) : "-"}</dd>
      <dt className="font-medium">Enabled</dt>
      <dd>{agent.enabled ? "Yes" : "No"}</dd>
    </dl>
  );
}

export function AgentChangeSummary({
  before,
  after,
}: {
  before: Partial<Agent>;
  after: Partial<Agent>;
}) {
  const fields: Array<keyof Agent> = ["name", "department", "model", "crond", "timeout_seconds", "enabled"];
  return (
    <dl className="space-y-2 text-sm">
      {fields.map((field) => {
        const oldValue = before[field];
        const newValue = after[field];
        const changed = String(oldValue) !== String(newValue);
        return (
          <div key={field} className={changed ? "rounded bg-amber-50 p-2" : ""}>
            <dt className="font-medium capitalize">{field}</dt>
            <dd>
              {changed ? (
                <>
                  <span className="line-through text-slate-400">{String(oldValue ?? "")}</span>
                  <span className="mx-2">→</span>
                  <span>{String(newValue ?? "")}</span>
                </>
              ) : (
                String(newValue ?? "")
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
