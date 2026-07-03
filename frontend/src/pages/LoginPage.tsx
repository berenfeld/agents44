import { useEffect, useState } from "react";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { api } from "@/api/client";
import { AppFooter } from "@/components/ui/app-footer";
import { Button, Input, Label } from "@/components/ui/primitives";

type DevLoginConfig = {
  enabled: boolean;
  email: string;
};

type GoogleLoginConfig = {
  enabled: boolean;
  clientId: string;
};

const defaultDevEmail = import.meta.env.DEV_LOGIN_EMAIL || "";
const defaultDevPassword = import.meta.env.DEV_LOGIN_PASSWORD || "";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [devLoginEnabled, setDevLoginEnabled] = useState(Boolean(defaultDevEmail));
  const [googleLogin, setGoogleLogin] = useState<GoogleLoginConfig | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [email, setEmail] = useState(defaultDevEmail);
  const [password, setPassword] = useState(defaultDevPassword);

  useEffect(() => {
    api
      .get<DevLoginConfig>("/auth/dev-login/config")
      .then((response) => {
        setDevLoginEnabled(response.data.enabled);
        if (response.data.enabled) {
          setEmail(response.data.email);
        }
      })
      .catch(() => {
        setDevLoginEnabled(false);
      });

    api
      .get<GoogleLoginConfig>("/auth/google/config")
      .then((response) => {
        if (response.data.enabled && response.data.clientId) {
          setGoogleLogin(response.data);
        }
      })
      .catch(() => {
        setGoogleLogin(null);
      });
  }, []);

  const googleButton = googleLogin ? (
    <GoogleOAuthProvider clientId={googleLogin.clientId}>
      <div className="flex justify-center">
        <GoogleLogin
          onSuccess={async (response) => {
            setGoogleError(null);
            try {
              await api.post("/auth/google", { credential: response.credential });
              onLogin();
            } catch {
              setGoogleError("Google sign-in failed. Check that your email is allowed.");
            }
          }}
          onError={() => {
            setGoogleError("Google sign-in was cancelled or failed.");
          }}
          useOneTap={false}
          width="360"
        />
      </div>
    </GoogleOAuthProvider>
  ) : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow">
          <h1 className="text-2xl font-semibold">Agents44 Login</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in to manage agents and workspace files.</p>
          <div className="mt-6 space-y-4">
            {googleButton}
            {googleError ? <p className="text-sm text-red-600">{googleError}</p> : null}
            {devLoginEnabled ? (
              <>
                <div>
                  <Label htmlFor="dev-email">Dev login email</Label>
                  <Input id="dev-email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="dev-password">Dev login password</Label>
                  <Input
                    id="dev-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    await api.post("/auth/dev-login", { email, password });
                    onLogin();
                  }}
                >
                  Dev login
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
