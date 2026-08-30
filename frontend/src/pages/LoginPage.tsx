import { FormEvent, useEffect, useRef, useState } from "react";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { api, userFacingApiError } from "@/api/client";
import { AppFooter } from "@/components/ui/app-footer";
import { NoticeModal } from "@/components/ui/modal";
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

/** Google Identity Services accepts 200–400px button widths. */
const GOOGLE_BUTTON_MIN_WIDTH = 200;
const GOOGLE_BUTTON_MAX_WIDTH = 400;

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

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
    <div ref={containerRef} dir="ltr" className="relative w-full">
      <Button
        type="button"
        variant="outline"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none w-full gap-3"
      >
        <GoogleMark />
        Sign in with Google
      </Button>
      <div className="google-login-button absolute inset-0 z-10 overflow-hidden opacity-0">
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
    </div>
  );
}

export default function LoginPage({ onLogin }: { onLogin: () => void | Promise<void> }) {
  const [devLoginEnabled, setDevLoginEnabled] = useState(Boolean(defaultDevEmail));
  const [googleLogin, setGoogleLogin] = useState<GoogleLoginConfig | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [email, setEmail] = useState(defaultDevEmail);
  const [password, setPassword] = useState(defaultDevPassword);

  async function handleDevLogin(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setDevSubmitting(true);
    try {
      await api.post("/auth/dev-login", { email, password });
      await onLogin();
    } catch (err) {
      setNotice({ title: "Could not sign in", message: userFacingApiError(err) });
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
          try {
            await api.post("/auth/google", { credential });
            await onLogin();
          } catch (err) {
            setNotice({ title: "Could not sign in", message: userFacingApiError(err) });
          }
        }}
        onError={() => {
          setNotice({
            title: "Could not sign in",
            message: "Google sign-in was cancelled or failed.",
          });
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
                <Button variant="outline" className="w-full" type="submit" disabled={devSubmitting}>
                  {devSubmitting ? "Signing in..." : "Dev login"}
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>
      <NoticeModal
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title || "Notice"}
        description={notice ? <p>{notice.message}</p> : null}
      />
      <AppFooter />
    </div>
  );
}
