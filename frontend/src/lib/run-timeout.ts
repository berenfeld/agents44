import { formatDuration, runDurationSeconds } from "@/lib/utils";
import { formatTimeoutSeconds } from "@/lib/timeout";

export type AgentActiveRun = {
  id: number;
  started_at: string | null;
  elapsed_seconds: number;
  timeout_seconds: number;
  timeout_sigterm_grace_seconds: number;
  timeout_sigkill_grace_seconds: number;
  timeout_sigterm_at_seconds: number;
  timeout_sigkill_at_seconds: number;
};

export type TimeoutChangeImpact =
  | { kind: "none"; timeUntilSigterm: number; timeUntilSigkill: number }
  | { kind: "sigterm_immediate" }
  | { kind: "sigkill_immediate" };

export function computeTimeoutChangeImpact(
  activeRun: AgentActiveRun,
  newTimeoutSeconds: number,
): TimeoutChangeImpact & {
  elapsedSeconds: number;
  currentSigtermAt: number;
  currentSigkillAt: number;
  newSigtermAt: number;
  newSigkillAt: number;
} {
  const elapsedSeconds =
    runDurationSeconds(activeRun.started_at, null) ?? Math.floor(activeRun.elapsed_seconds);
  const currentSigtermAt = activeRun.timeout_sigterm_at_seconds;
  const currentSigkillAt = activeRun.timeout_sigkill_at_seconds;
  const newSigtermAt = newTimeoutSeconds + activeRun.timeout_sigterm_grace_seconds;
  const newSigkillAt = newTimeoutSeconds + activeRun.timeout_sigkill_grace_seconds;

  if (elapsedSeconds >= newSigkillAt) {
    return {
      kind: "sigkill_immediate",
      elapsedSeconds,
      currentSigtermAt,
      currentSigkillAt,
      newSigtermAt,
      newSigkillAt,
    };
  }
  if (elapsedSeconds >= newSigtermAt) {
    return {
      kind: "sigterm_immediate",
      elapsedSeconds,
      currentSigtermAt,
      currentSigkillAt,
      newSigtermAt,
      newSigkillAt,
    };
  }

  return {
    kind: "none",
    elapsedSeconds,
    currentSigtermAt,
    currentSigkillAt,
    newSigtermAt,
    newSigkillAt,
    timeUntilSigterm: newSigtermAt - elapsedSeconds,
    timeUntilSigkill: newSigkillAt - elapsedSeconds,
  };
}

export function formatSecondsLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function describeTimeoutChangeImpact(
  agentName: string,
  activeRun: AgentActiveRun,
  currentTimeoutSeconds: number,
  newTimeoutSeconds: number,
): string[] {
  const impact = computeTimeoutChangeImpact(activeRun, newTimeoutSeconds);
  const lines = [
    `Agent ${agentName} is running (run #${activeRun.id}).`,
    `Elapsed: ${formatDuration(activeRun.started_at, null)}.`,
    `Timeout: ${formatTimeoutSeconds(currentTimeoutSeconds)} → ${formatTimeoutSeconds(newTimeoutSeconds)}.`,
    `SIGTERM at: ${formatTimeoutSeconds(impact.currentSigtermAt)} → ${formatTimeoutSeconds(impact.newSigtermAt)}.`,
    `SIGKILL at: ${formatTimeoutSeconds(impact.currentSigkillAt)} → ${formatTimeoutSeconds(impact.newSigkillAt)}.`,
  ];

  if (impact.kind === "sigkill_immediate") {
    lines.push("This change will send SIGKILL immediately (run has already exceeded the new SIGKILL deadline).");
  } else if (impact.kind === "sigterm_immediate") {
    lines.push("This change will send SIGTERM immediately (run has already exceeded the new SIGTERM deadline).");
  } else {
    lines.push(
      `Time until SIGTERM: ${formatSecondsLabel(impact.timeUntilSigterm)}.`,
      `Time until SIGKILL: ${formatSecondsLabel(impact.timeUntilSigkill)}.`,
    );
  }

  return lines;
}
