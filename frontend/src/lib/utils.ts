import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatCost(value: number | null) {
  if (value === null || value === undefined) return "-";
  return `$${value.toFixed(4)}`;
}

export function runDurationSeconds(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  const totalSeconds = runDurationSeconds(startedAt, finishedAt);
  if (totalSeconds === null) return "-";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatTokens(tokensIn: number | null, tokensOut: number | null): string {
  if (tokensIn == null && tokensOut == null) return "-";
  return `${tokensIn ?? "-"} / ${tokensOut ?? "-"}`;
}

export function runTokensTotal(tokensIn: number | null, tokensOut: number | null): number {
  if (tokensIn == null && tokensOut == null) return -1;
  return (tokensIn ?? 0) + (tokensOut ?? 0);
}
