import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/api/client";
import { ConfirmModal } from "@/components/ui/modal";
import { appVersion } from "@/lib/version";

const VERSION_CACHE_KEY = "agents44:server-version";
const HEALTH_POLL_MS = 60_000;

export type HealthResponse = {
  ok: boolean;
  version: string;
  utc: string;
};

type AppHealthContextValue = {
  version: string | null;
  serverTimeUtc: string | null;
};

const AppHealthContext = createContext<AppHealthContextValue>({
  version: null,
  serverTimeUtc: null,
});

function formatUtc(date: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(date) + " UTC"
  );
}

function applyVersionCheck(version: string, onStale: () => void) {
  const cached = localStorage.getItem(VERSION_CACHE_KEY);
  const buildVersion = appVersion();

  if (version === buildVersion) {
    localStorage.setItem(VERSION_CACHE_KEY, version);
    return;
  }

  if (cached !== null && cached !== version) {
    onStale();
    return;
  }

  if (cached === null) {
    localStorage.setItem(VERSION_CACHE_KEY, version);
  }
}

export function AppHealthProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [serverTimeUtc, setServerTimeUtc] = useState<string | null>(null);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);

  useEffect(() => {
    let offsetMs = 0;
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const syncHealth = async () => {
      try {
        const response = await api.get<HealthResponse>("/health");
        const { version: serverVersion, utc } = response.data;
        setVersion(serverVersion);

        const serverMs = new Date(utc).getTime();
        if (!Number.isNaN(serverMs)) {
          offsetMs = serverMs - Date.now();
        }

        applyVersionCheck(serverVersion, () => {
          setPendingVersion(serverVersion);
          setReloadOpen(true);
        });
      } catch {
        setServerTimeUtc(formatUtc(new Date(Date.now() + offsetMs)));
      }
    };

    void syncHealth();
    pollTimer = setInterval(() => {
      void syncHealth();
    }, HEALTH_POLL_MS);

    tickTimer = setInterval(() => {
      setServerTimeUtc(formatUtc(new Date(Date.now() + offsetMs)));
    }, 1000);

    return () => {
      if (tickTimer) {
        clearInterval(tickTimer);
      }
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
  }, []);

  return (
    <AppHealthContext.Provider value={{ version, serverTimeUtc }}>
      {children}
      <ConfirmModal
        open={reloadOpen}
        onOpenChange={setReloadOpen}
        title="Update available"
        description={
          <p>
            A new version is available
            {pendingVersion ? (
              <>
                {" "}
                (<strong>{pendingVersion}</strong>)
              </>
            ) : null}
            . Reload to get the latest changes.
          </p>
        }
        confirmLabel="Reload"
        onConfirm={() => {
          window.location.reload();
        }}
      />
    </AppHealthContext.Provider>
  );
}

export function useAppHealth() {
  return useContext(AppHealthContext);
}
