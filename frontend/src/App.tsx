import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { ConfirmModal } from "@/components/ui/modal";
import AgentsPage from "@/pages/AgentsPage";
import AgentsRunsPage from "@/pages/AgentsRunsPage";
import AgentFilesPage from "@/pages/AgentFilesPage";
import AgentDatabasePage from "@/pages/AgentDatabasePage";
import DepartmentsPage from "@/pages/DepartmentsPage";
import LoginPage from "@/pages/LoginPage";
import SettingsPage from "@/pages/SettingsPage";
import { Button } from "@/components/ui/primitives";

function Layout({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [logoutOpen, setLogoutOpen] = useState(false);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <strong>Agents44</strong>
            <nav className="flex gap-2">
              <NavLink to="/agents" className={linkClass}>
                Agents
              </NavLink>
              <NavLink to="/agents_runs" className={linkClass}>
                Agents Runs
              </NavLink>
              <NavLink to="/departments" className={linkClass}>
                Departments
              </NavLink>
              <NavLink to="/agents_files" className={linkClass}>
                Agent Files
              </NavLink>
              <NavLink to="/agent_database" className={linkClass}>
                Agent Database
              </NavLink>
              <NavLink to="/settings" className={linkClass}>
                Settings
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>{email}</span>
            <Button variant="outline" onClick={() => setLogoutOpen(true)}>
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
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

  if (loading) return <div className="p-8">Loading...</div>;
  if (!email) {
    return (
      <LoginPage
        onLogin={async () => {
          await refreshAuth();
          navigate("/agents");
        }}
      />
    );
  }

  return (
    <Layout
      email={email}
      onLogout={async () => {
        await api.post("/auth/logout");
        setEmail(null);
      }}
    />
  );
}
