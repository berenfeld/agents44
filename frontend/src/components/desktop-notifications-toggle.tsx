import { useDesktopNotifications } from "@/hooks/useDesktopNotifications";
import { Button } from "@/components/ui/primitives";

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 21a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DesktopNotificationsToggle() {
  const { enabled, busy, enable, disable, permission, supported } = useDesktopNotifications();

  const label = !supported
    ? "Notifications unavailable"
    : permission === "denied"
      ? "Notifications blocked"
      : enabled
        ? "Notifications on"
        : busy
          ? "Enabling notifications..."
          : "Enable notifications";

  return (
    <Button
      type="button"
      variant={enabled ? "default" : "outline"}
      disabled={busy || !supported}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      aria-busy={busy}
      onClick={() => {
        if (enabled) {
          void disable();
          return;
        }
        void enable();
      }}
      className="inline-flex items-center gap-2"
    >
      <BellIcon className="h-4 w-4" />
      <span className="hidden sm:inline">{enabled ? "Notifications on" : busy ? "Enabling..." : "Notifications"}</span>
    </Button>
  );
}
