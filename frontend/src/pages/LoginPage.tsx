import { useState } from "react";
import { api } from "@/api/client";
import { isLocalhostHost } from "@/lib/localhost";
import { Button, Input, Label } from "@/components/ui/primitives";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("dev@local");
  const devLoginEnabled = isLocalhostHost(window.location.hostname);

  return (
    <div className="mx-auto mt-24 max-w-md rounded-lg border bg-white p-6 shadow">
      <h1 className="text-2xl font-semibold">Agents44 Login</h1>
      <p className="mt-2 text-sm text-slate-600">Sign in to manage agents and workspace files.</p>
      <div className="mt-6 space-y-4">
        <Button className="w-full" onClick={() => (window.location.href = "/api/auth/google")}>
          Sign in with Google
        </Button>
        {devLoginEnabled ? (
          <>
            <div>
              <Label htmlFor="dev-email">Dev login email</Label>
              <Input id="dev-email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await api.post("/auth/dev-login", { email });
                onLogin();
              }}
            >
              Dev login
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
