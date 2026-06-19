export function formatTimeoutSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function parseTimeoutInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds >= 1 && seconds <= 86400 ? seconds : null;
  }

  const match = /^(\d+):(\d{1,2})$/.exec(trimmed);
  if (!match) return null;

  const minutes = Number(match[1]);
  const secs = Number(match[2]);
  if (secs >= 60) return null;

  const total = minutes * 60 + secs;
  return total >= 1 && total <= 86400 ? total : null;
}

export function getTimeoutError(value: string): string | null {
  if (!value.trim()) return "Timeout is required";
  if (parseTimeoutInput(value) === null) return "Use mm:ss (e.g. 5:00) or seconds";
  return null;
}
