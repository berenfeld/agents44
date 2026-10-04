import re


def format_timeout_seconds(seconds: int) -> str:
    minutes = seconds // 60
    secs = seconds % 60
    return f"{minutes}:{secs:02d}"


def format_remaining_duration(seconds: int) -> str:
    """Human-readable remaining duration for agent prompts (e.g. `3m 12s`)."""
    total = max(0, int(seconds))
    minutes, secs = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes}m {secs}s"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def parse_timeout_input(value: str) -> int | None:
    trimmed = value.strip()
    if not trimmed:
        return None

    if re.fullmatch(r"\d+", trimmed):
        seconds = int(trimmed)
        return seconds if 1 <= seconds <= 86400 else None

    match = re.fullmatch(r"(\d+):(\d{1,2})", trimmed)
    if not match:
        return None

    minutes = int(match.group(1))
    secs = int(match.group(2))
    if secs >= 60:
        return None

    total = minutes * 60 + secs
    return total if 1 <= total <= 86400 else None
