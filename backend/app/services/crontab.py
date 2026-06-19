from apscheduler.triggers.cron import CronTrigger

from app.errors import APIClientError


def validate_crontab(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    try:
        CronTrigger.from_crontab(stripped)
    except ValueError as exc:
        raise APIClientError(f"Invalid cron schedule: {exc}", 400) from exc
    return stripped
