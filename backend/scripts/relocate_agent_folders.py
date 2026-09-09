#!/usr/bin/env python3
"""One-time: move workspace/{agent} to workspace/{department}/{agent}.

Reads agents from Postgres and mv's each old top-level agent folder under its
department. Also rewrites run_dir / prompt_path / log_path so existing runs
still resolve.

Usage (Lightsail container named agents44-agents):

  docker exec agents44-agents /opt/agents44/venv/bin/python \\
    /opt/agents44/backend/scripts/relocate_agent_folders.py

From a backend checkout with DB + workspace env:

  cd backend && python scripts/relocate_agent_folders.py

Pass --dry-run to print actions without changing files or the database.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from flask import Flask

from app.config import Config
from app.extensions import db
from app.models import SystemAgent, SystemAgentRun

PATH_FIELDS = ("run_dir", "prompt_path", "log_path")


def _relocate_tree(src: Path, dst: Path, *, dry_run: bool) -> None:
    if not src.exists():
        return
    if src.resolve() == dst.resolve():
        return

    if not dst.exists():
        print(f"  mv {src} -> {dst}")
        if not dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
        return

    if src.is_dir() and dst.is_dir():
        for child in list(src.iterdir()):
            _relocate_tree(child, dst / child.name, dry_run=dry_run)
        if src.exists() and src.is_dir() and not any(src.iterdir()):
            print(f"  rmdir {src}")
            if not dry_run:
                src.rmdir()
        return

    if src.is_file() and dst.is_file():
        print(f"  mv -f {src} -> {dst}")
        if not dry_run:
            dst.unlink()
            shutil.move(str(src), str(dst))
        return

    raise RuntimeError(f"Cannot merge {src} onto {dst}")


def _rewrite_run_paths(agent: SystemAgent, old_prefix: str, new_prefix: str, *, dry_run: bool) -> int:
    updated = 0
    runs = SystemAgentRun.query.filter_by(agent_id=agent.id).all()
    for run in runs:
        changed = False
        for field in PATH_FIELDS:
            value = getattr(run, field)
            if not value:
                continue
            if value.startswith(old_prefix) and not value.startswith(new_prefix):
                new_value = new_prefix + value[len(old_prefix) :]
                print(f"  run {run.id} {field}: {value} -> {new_value}")
                if not dry_run:
                    setattr(run, field, new_value)
                changed = True
        if changed:
            updated += 1
    return updated


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    app = Flask("relocate_agent_folders")
    app.config.from_object(Config)
    db.init_app(app)

    moved = 0
    skipped = 0
    runs_updated = 0

    with app.app_context():
        root = Path(app.config["WORKSPACE_PATH"]).resolve()
        if not root.exists():
            print(f"Workspace does not exist: {root}")
            return 1

        agents = SystemAgent.query.order_by(SystemAgent.name).all()
        print(f"Workspace: {root}")
        print(f"Agents: {len(agents)}  dry_run={dry_run}")

        for agent in agents:
            old_dir = (root / agent.name).resolve()
            new_dir = (root / agent.department / agent.name).resolve()
            old_prefix = f"{agent.name}/"
            new_prefix = f"{agent.department}/{agent.name}/"
            print(f"{agent.name} ({agent.department})")

            if old_dir.exists() and old_dir.is_dir() and old_dir != new_dir:
                _relocate_tree(old_dir, new_dir, dry_run=dry_run)
                moved += 1
            else:
                skipped += 1
                if new_dir.exists():
                    print("  already at new location")
                else:
                    print("  no old folder (new layout will create it on next app start)")

            runs_updated += _rewrite_run_paths(agent, old_prefix, new_prefix, dry_run=dry_run)

        if not dry_run:
            db.session.commit()

    print(f"Done. moved={moved} skipped={skipped} runs_updated={runs_updated} dry_run={dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
