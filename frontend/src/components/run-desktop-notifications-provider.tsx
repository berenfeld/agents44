import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentRun, api } from "@/api/client";
import { NoticeModal } from "@/components/ui/modal";
import {
  DesktopNotificationsContext,
  type DesktopNotificationPermission,
} from "@/hooks/useDesktopNotifications";
import {
  currentNotificationPermission,
  desktopNotificationsSupported,
  disappearedActiveRunIds,
  diffRunLifecycleNotices,
  formatRunLifecycleNotice,
  mergeRunSnapshots,
  readDesktopNotificationsPreference,
  RUNS_NOTIFICATION_POLL_MS,
  showDesktopNotification,
  writeDesktopNotificationsPreference,
  type RunNotificationState,
} from "@/lib/desktop-notifications";

function toRunNotificationState(run: AgentRun): RunNotificationState {
  return {
    id: run.id,
    status: run.status,
    agentName: run.agent_name?.trim() || (run.agent_id != null ? `Agent #${run.agent_id}` : "Agent"),
    errorMessage: run.error_message,
  };
}

function permissionLabel(permission: DesktopNotificationPermission): string {
  if (permission === "unsupported") {
    return "This browser does not support desktop notifications.";
  }
  if (permission === "denied") {
    return "Notifications are blocked for this site. Allow them in the browser, then enable again.";
  }
  return "Could not enable desktop notifications.";
}

function axiosStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return undefined;
  }
  return (err as { response?: { status?: number } }).response?.status;
}

export function RunDesktopNotificationsProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

  const [permission, setPermission] = useState<DesktopNotificationPermission>(() => currentNotificationPermission());
  const [preferenceOn, setPreferenceOn] = useState(() => readDesktopNotificationsPreference());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const snapshotRef = useRef<Map<number, RunNotificationState> | null>(null);
  const busyRef = useRef(false);

  const supported = permission !== "unsupported";
  const enabled = supported && permission === "granted" && preferenceOn;

  const refreshPermission = useCallback(() => {
    setPermission(currentNotificationPermission());
  }, []);

  const openAgentsRuns = useCallback(() => {
    navigateRef.current("/agents_runs");
  }, []);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    refreshPermission();
    if (!desktopNotificationsSupported() || !navigator.permissions?.query) {
      return;
    }
    let cancelled = false;
    let status: PermissionStatus | undefined;
    void navigator.permissions
      .query({ name: "notifications" })
      .then((result) => {
        if (cancelled) {
          return;
        }
        status = result;
        setPermission(currentNotificationPermission());
        result.onchange = () => {
          setPermission(currentNotificationPermission());
        };
      })
      .catch(() => {
        if (!cancelled) {
          setPermission(currentNotificationPermission());
        }
      });
    return () => {
      cancelled = true;
      if (status) {
        status.onchange = null;
      }
    };
  }, [refreshPermission]);

  useEffect(() => {
    if (!enabled) {
      snapshotRef.current = null;
      return;
    }

    let cancelled = false;

    const poll = async () => {
      const [activeRes, recentRes] = await Promise.all([
        api.get<{ items: AgentRun[] }>("/runs", { params: { status: "pending,running", per_page: 200 } }),
        api.get<{ items: AgentRun[] }>("/runs", { params: { per_page: 50 } }),
      ]);
      if (cancelled) {
        return;
      }
      const active = activeRes.data.items.map(toRunNotificationState);
      const recent = recentRes.data.items.map(toRunNotificationState);
      const merged = mergeRunSnapshots(recent, active);
      const previous = snapshotRef.current;
      if (previous === null) {
        snapshotRef.current = merged;
        return;
      }

      const fetched: RunNotificationState[] = [];
      const retry: RunNotificationState[] = [];
      for (const id of disappearedActiveRunIds(previous, merged)) {
        if (cancelled) {
          return;
        }
        try {
          const res = await api.get<AgentRun>(`/runs/${id}`);
          fetched.push(toRunNotificationState(res.data));
        } catch (err) {
          if (axiosStatus(err) === 404) {
            continue;
          }
          const prior = previous.get(id);
          if (prior) {
            retry.push(prior);
          }
        }
      }
      if (cancelled) {
        return;
      }

      const current = mergeRunSnapshots([...merged.values()], fetched, retry);
      const notices = diffRunLifecycleNotices(previous, [...current.values()]);
      snapshotRef.current = mergeRunSnapshots(recent, active, retry);
      for (const item of notices) {
        const { title, body } = formatRunLifecycleNotice(item);
        showDesktopNotification({
          title,
          body,
          tag: `agents44-run-${item.runId}-${item.kind}`,
          onClick: openAgentsRuns,
        });
      }
    };

    void poll().catch(console.error);
    const timer = setInterval(() => {
      void poll().catch(console.error);
    }, RUNS_NOTIFICATION_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, openAgentsRuns]);

  const enable = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (!desktopNotificationsSupported()) {
        setPermission("unsupported");
        setNotice({
          title: "Could not enable desktop notifications",
          message: permissionLabel("unsupported"),
        });
        return;
      }

      let nextPermission = Notification.permission;
      if (nextPermission === "default") {
        nextPermission = await Notification.requestPermission();
      }
      setPermission(nextPermission);

      if (nextPermission !== "granted") {
        writeDesktopNotificationsPreference(false);
        setPreferenceOn(false);
        setNotice({
          title: "Could not enable desktop notifications",
          message: permissionLabel(nextPermission),
        });
        return;
      }

      writeDesktopNotificationsPreference(true);
      setPreferenceOn(true);
      showDesktopNotification({
        title: "Agents44",
        body: "Desktop notifications are on. You will be notified when an agent starts or finishes.",
        tag: "agents44-notifications-enabled",
        onClick: openAgentsRuns,
      });
      setNotice({
        title: "Desktop notifications enabled",
        message: "You will get a desktop alert when an agent starts or finishes. Keep this tab open.",
      });
    } catch {
      setNotice({
        title: "Could not enable desktop notifications",
        message: "This browser could not enable desktop notifications.",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [openAgentsRuns]);

  const disable = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      writeDesktopNotificationsPreference(false);
      setPreferenceOn(false);
      setNotice({
        title: "Desktop notifications disabled",
        message: "You will no longer get desktop alerts when an agent starts or finishes.",
      });
    } catch {
      setNotice({
        title: "Could not disable desktop notifications",
        message: "This browser could not save the notification preference.",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      supported,
      permission,
      preferenceOn,
      enabled,
      busy,
      enable,
      disable,
    }),
    [supported, permission, preferenceOn, enabled, busy, enable, disable],
  );

  return (
    <DesktopNotificationsContext.Provider value={value}>
      {children}
      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? <p>{notice.message}</p> : null}
      />
    </DesktopNotificationsContext.Provider>
  );
}
