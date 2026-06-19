export const CRONTAB_HELPER_URL = "https://crontab.guru/";

const CRON_FIELD = /^(\*|[A-Za-z0-9]+(-[A-Za-z0-9]+)?(\/[0-9]+)?)(,(\*|[A-Za-z0-9]+(-[A-Za-z0-9]+)?(\/[0-9]+)?))*$/;

export function getCrontabError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return "Use 5 fields: minute hour day month weekday";
  }

  for (const field of fields) {
    if (!CRON_FIELD.test(field)) {
      return "Invalid cron expression";
    }
  }

  return null;
}

export function normalizeCrontab(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}
