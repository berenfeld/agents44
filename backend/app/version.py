import os


def app_version() -> str:
    return (os.getenv("REACT_APP_VERSION") or "dev").strip()
