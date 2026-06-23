import { cn } from "@/lib/utils";

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("h-3 w-3", className)}
      aria-hidden="true"
    >
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </svg>
  );
}

export function StopRunButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Stop run"
      title="Stop run"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <StopIcon />
    </button>
  );
}
