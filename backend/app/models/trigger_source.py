import enum


class TriggerSource(str, enum.Enum):
    manual = "manual"
    cron = "cron"
