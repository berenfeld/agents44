import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { AppNav } from "@/components/ui/app-nav";
import { DesktopNotificationsToggle } from "@/components/desktop-notifications-toggle";
import { RunDesktopNotificationsProvider } from "@/components/run-desktop-notifications-provider";
import { ConfirmModal } from "@/components/ui/modal";
import AgentsPage from "@/pages/AgentsPage";
import AgentsRunsPage from "@/pages/AgentsRunsPage";
import AgentFilesPage from "@/pages/AgentFilesPage";
import AgentDatabasePage from "@/pages/AgentDatabasePage";
import ClaudePage from "@/pages/ClaudePage";
import DepartmentsPage from "@/pages/DepartmentsPage";
import LoginPage from "@/pages/LoginPage";
import SettingsPage from "@/pages/SettingsPage";
import { Button } from "@/components/ui/primitives";
import { AppFooter } from "@/components/ui/app-footer";

function Layout({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [logoutOpen, setLogoutOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex w-full max-w-none flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-3 text-sm md:order-2">
            <span className="min-w-0 truncate text-slate-600">{email}</span>
            <div className="flex shrink-0 items-center gap-2">
              <DesktopNotificationsToggle />
              <Button variant="outline" onClick={() => setLogoutOpen(true)}>
                Logout
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:order-1 md:flex-row md:items-center md:gap-4">
            <strong className="shrink-0">Agents44</strong>
            <AppNav />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-none flex-1 px-4 py-6">
        <Routes>
          <Route path="/claude" element={<ClaudePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents_runs" element={<AgentsRunsPage />} />
          <Route path="/runs" element={<Navigate to="/agents_runs" replace />} />
          <Route path="/departments" element={<DepartmentsPage />} />
          <Route path="/agents_files/*" element={<AgentFilesPage />} />
          <Route path="/agent_database" element={<AgentDatabasePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/files" element={<Navigate to="/agents_files" replace />} />
          <Route path="*" element={<Navigate to="/agents" replace />} />
        </Routes>
      </main>

      <AppFooter />

      <ConfirmModal
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Log out?"
        confirmLabel="Logout"
        description={<p>Log out as <strong>{email}</strong>?</p>}
        onConfirm={() => {
          setLogoutOpen(false);
          onLogout();
        }}
      />
    </div>
  );
}

export default function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refreshAuth = async () => {
    try {
      const res = await api.get<{ authenticated: boolean; email: string }>("/auth/me");
      setEmail(res.data.email);
    } catch {
      setEmail(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAuth().catch(console.error);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <div className="flex flex-1 items-center justify-center p-8">Loading...</div>
        <AppFooter />
      </div>
    );
  }
  if (!email) {
    return (
      <LoginPage
        onLogin={async () => {
          const res = await api.get<{ authenticated: boolean; email: string }>("/auth/me");
          setEmail(res.data.email);
          navigate("/agents");
        }}
      />
    );
  }

  return (
    <RunDesktopNotificationsProvider>
      <Layout
        email={email}
        onLogout={async () => {
          await api.post("/auth/logout");
          setEmail(null);
        }}
      />
    </RunDesktopNotificationsProvider>
  );
}
