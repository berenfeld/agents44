#!/usr/bin/env python3
"""Backfill tokens and cost on agent runs from stored run log stdout."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from app import create_app
from app.extensions import db
from app.models import SystemAgentRun
from app.services.model_registry import parse_claude_result

STDOUT_SECTION_RE = re.compile(
    r"=== STDOUT ===\n(.*?)(?:\n=== STDERR ===|\Z)",
    re.DOTALL,
)


def extract_stdout_from_log(log_text: str) -> str:
    match = STDOUT_SECTION_RE.search(log_text)
    if not match:
        return ""
    return match.group(1).rstrip("\n")


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    app = create_app()
    updated = 0
    skipped = 0
    missing_log = 0
    no_result = 0

    with app.app_context():
        workspace = Path(app.config["WORKSPACE_PATH"]).resolve()
        runs = SystemAgentRun.query.order_by(SystemAgentRun.id).all()
        print(f"Found {len(runs)} runs")

        for run in runs:
            if not run.log_path:
                skipped += 1
                continue

            log_file = workspace / run.log_path
            if not log_file.exists():
                missing_log += 1
                print(f"run {run.id}: log missing at {log_file}")
                continue

            stdout = extract_stdout_from_log(log_file.read_text(encoding="utf-8"))
            tokens_in, tokens_out, cost_usd = parse_claude_result(stdout, run.model)
            if tokens_in is None and tokens_out is None and cost_usd is None:
                no_result += 1
                print(f"run {run.id}: no Claude result envelope in log")
                continue

            changed = (
                run.tokens_in != tokens_in
                or run.tokens_out != tokens_out
                or (
                    None
                    if run.estimated_cost_usd is None and cost_usd is None
                    else float(run.estimated_cost_usd or 0) != float(cost_usd or 0)
                )
            )
            if not changed:
                skipped += 1
                continue

            print(
                f"run {run.id}: "
                f"tokens {run.tokens_in}/{run.tokens_out} cost {run.estimated_cost_usd} "
                f"-> {tokens_in}/{tokens_out} cost {cost_usd}"
            )
            if not dry_run:
                run.tokens_in = tokens_in
                run.tokens_out = tokens_out
                run.estimated_cost_usd = cost_usd
            updated += 1

        if not dry_run and updated:
            db.session.commit()

    print(
        f"Done. updated={updated} skipped={skipped} "
        f"missing_log={missing_log} no_result={no_result} dry_run={dry_run}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
