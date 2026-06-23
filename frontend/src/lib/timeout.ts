const MIN_SECONDS = 1;
const MAX_SECONDS = 86400;

export function formatTimeoutSeconds(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

export function normalizeTimeoutInput(value: string): string {
  return value.trim().toLowerCase();
}

export function parseTimeoutInput(value: string): number | null {
  const trimmed = normalizeTimeoutInput(value);
  if (!trimmed) return null;

  const match = /^(\d+)([smh])$/.exec(trimmed);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 1) return null;

  const unit = match[2];
  const total = unit === "s" ? amount : unit === "m" ? amount * 60 : amount * 3600;
  return total >= MIN_SECONDS && total <= MAX_SECONDS ? total : null;
}

export function getTimeoutError(value: string): string | null {
  if (!normalizeTimeoutInput(value)) return "Timeout is required";
  if (parseTimeoutInput(value) === null) return "Use duration like 30s, 5m, or 1h";
  return null;
}
