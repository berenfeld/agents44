export const DESKTOP_NOTIFICATIONS_STORAGE_KEY = "agents44:desktop-notifications";
export const RUNS_NOTIFICATION_POLL_MS = 5000;

export type RunNotificationState = {
  id: number;
  status: string;
  agentName: string;
  errorMessage: string | null;
};

export type RunLifecycleNotice = {
  kind: "start" | "stop";
  runId: number;
  agentName: string;
  status: string;
  errorMessage: string | null;
};

export function desktopNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function readDesktopNotificationsPreference(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeDesktopNotificationsPreference(enabled: boolean): void {
  window.localStorage.setItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY, enabled ? "on" : "off");
}

export function currentNotificationPermission(): NotificationPermission | "unsupported" {
  if (!desktopNotificationsSupported()) {
    return "unsupported";
  }
  return Notification.permission;
}

export function isActiveRunStatus(status: string): boolean {
  return status === "running" || status === "pending";
}

export function isTerminalRunStatus(status: string): boolean {
  return status === "success" || status === "failed";
}

export function snapshotFromRuns(runs: RunNotificationState[]): Map<number, RunNotificationState> {
  return new Map(runs.map((run) => [run.id, run]));
}

export function mergeRunSnapshots(
  ...lists: ReadonlyArray<readonly RunNotificationState[]>
): Map<number, RunNotificationState> {
  const map = new Map<number, RunNotificationState>();
  for (const list of lists) {
    for (const run of list) {
      map.set(run.id, run);
    }
  }
  return map;
}

export function disappearedActiveRunIds(
  previous: ReadonlyMap<number, RunNotificationState>,
  current: ReadonlyMap<number, RunNotificationState>,
): number[] {
  const missing: number[] = [];
  for (const [id, run] of previous) {
    if (isActiveRunStatus(run.status) && !current.has(id)) {
      missing.push(id);
    }
  }
  return missing;
}

export function diffRunLifecycleNotices(
  previous: ReadonlyMap<number, RunNotificationState>,
  current: RunNotificationState[],
): RunLifecycleNotice[] {
  const notices: RunLifecycleNotice[] = [];

  for (const run of current) {
    const prior = previous.get(run.id);
    if (!prior) {
      if (isActiveRunStatus(run.status)) {
        notices.push({
          kind: "start",
          runId: run.id,
          agentName: run.agentName,
          status: run.status,
          errorMessage: run.errorMessage,
        });
      } else if (isTerminalRunStatus(run.status)) {
        notices.push({
          kind: "stop",
          runId: run.id,
          agentName: run.agentName,
          status: run.status,
          errorMessage: run.errorMessage,
        });
      }
      continue;
    }

    if (isActiveRunStatus(prior.status) && isTerminalRunStatus(run.status)) {
      notices.push({
        kind: "stop",
        runId: run.id,
        agentName: run.agentName,
        status: run.status,
        errorMessage: run.errorMessage,
      });
    }
  }

  return notices;
}

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatRunLifecycleNotice(notice: RunLifecycleNotice): { title: string; body: string } {
  if (notice.kind === "start") {
    return {
      title: notice.agentName,
      body: notice.status === "pending" ? "Queued" : "Started",
    };
  }
  if (notice.status === "success") {
    return { title: notice.agentName, body: "Succeeded" };
  }
  if (notice.status === "failed") {
    const detail = notice.errorMessage ? truncate(notice.errorMessage, 100) : "";
    return {
      title: notice.agentName,
      body: detail ? `Failed: ${detail}` : "Failed",
    };
  }
  return { title: notice.agentName, body: `Ended (${notice.status})` };
}

export function showDesktopNotification(options: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}): boolean {
  if (!desktopNotificationsSupported() || Notification.permission !== "granted") {
    return false;
  }

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
    });
    notification.onclick = () => {
      window.focus();
      options.onClick?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
