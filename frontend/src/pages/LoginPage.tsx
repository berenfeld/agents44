import { FormEvent, useEffect, useRef, useState } from "react";
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
// Production image is built without .env — never prefill a stale local password.
const defaultDevPassword = import.meta.env.DEV ? import.meta.env.DEV_LOGIN_PASSWORD || "" : "";

function apiErrorMessage(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return null;
  }
  const payload = (err as { response?: { data?: { error?: unknown } } }).response?.data?.error;
  return typeof payload === "string" && payload.trim() ? payload : null;
}

/** Google Identity Services accepts 200–400px button widths. */
const GOOGLE_BUTTON_MIN_WIDTH = 200;
const GOOGLE_BUTTON_MAX_WIDTH = 400;

function FittedGoogleLogin({
  onSuccess,
  onError,
}: {
  onSuccess: (credential: string) => Promise<void> | void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [buttonWidth, setButtonWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const updateWidth = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next <= 0) {
        return;
      }
      const clamped = Math.min(GOOGLE_BUTTON_MAX_WIDTH, Math.max(GOOGLE_BUTTON_MIN_WIDTH, next));
      setButtonWidth((prev) => (prev === clamped ? prev : clamped));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} dir="ltr" className="google-login-button w-full">
      {buttonWidth ? (
        <GoogleLogin
          key={buttonWidth}
          onSuccess={async (response) => {
            if (response.credential) {
              await onSuccess(response.credential);
            }
          }}
          onError={onError}
          useOneTap={false}
          type="standard"
          theme="outline"
          size="large"
          text="signin_with"
          shape="rectangular"
          logo_alignment="left"
          width={buttonWidth}
        />
      ) : null}
    </div>
  );
}

export default function LoginPage({ onLogin }: { onLogin: () => void | Promise<void> }) {
  const [devLoginEnabled, setDevLoginEnabled] = useState(Boolean(defaultDevEmail));
  const [googleLogin, setGoogleLogin] = useState<GoogleLoginConfig | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [email, setEmail] = useState(defaultDevEmail);
  const [password, setPassword] = useState(defaultDevPassword);

  async function handleDevLogin(event: FormEvent) {
    event.preventDefault();
    setGoogleError(null);
    setDevError(null);
    setDevSubmitting(true);
    try {
      await api.post("/auth/dev-login", { email, password });
      await onLogin();
    } catch (err) {
      setDevError(apiErrorMessage(err) || "Dev login failed. Check the email and password.");
    } finally {
      setDevSubmitting(false);
    }
  }

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
    <GoogleOAuthProvider clientId={googleLogin.clientId} locale="en">
      <FittedGoogleLogin
        onSuccess={async (credential) => {
          setGoogleError(null);
          try {
            await api.post("/auth/google", { credential });
            await onLogin();
          } catch (err) {
            setGoogleError(
              apiErrorMessage(err) || "Google sign-in failed. Check that your email is allowed.",
            );
          }
        }}
        onError={() => {
          setGoogleError("Google sign-in was cancelled or failed.");
        }}
      />
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
              <form className="space-y-4" onSubmit={handleDevLogin} autoComplete="off">
                <div>
                  <Label htmlFor="dev-email">Dev login email</Label>
                  <Input
                    id="dev-email"
                    name="username"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dev-password">Dev login password</Label>
                  <Input
                    id="dev-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {devError ? <p className="text-sm text-red-600">{devError}</p> : null}
                <Button variant="outline" className="w-full" type="submit" disabled={devSubmitting}>
                  {devSubmitting ? "Signing in..." : "Dev login"}
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
