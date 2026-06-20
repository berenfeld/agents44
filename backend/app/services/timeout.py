import re


def format_timeout_seconds(seconds: int) -> str:
    minutes = seconds // 60
    secs = seconds % 60
    return f"{minutes}:{secs:02d}"


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
