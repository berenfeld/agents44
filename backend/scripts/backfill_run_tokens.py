#!/usr/bin/env python3
"""Backfill tokens and cost on agent runs from stored run log stdout."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from app import create_app
from app.extensions import db
from app.models import SystemAgentRun
from app.services.model_registry import estimate_cost

TOKENS_RE = re.compile(r"^tokens_in:\s*(\d+)\s*$", re.MULTILINE)
TOKENS_OUT_RE = re.compile(r"^tokens_out:\s*(\d+)\s*$", re.MULTILINE)
COST_RE = re.compile(r"^estimated_cost_usd:\s*([0-9.]+)\s*$", re.MULTILINE)


def parse_usage_from_log(log_text: str, model: str | None) -> tuple[int | None, int | None, float | None]:
    tin_match = TOKENS_RE.search(log_text)
    tout_match = TOKENS_OUT_RE.search(log_text)
    cost_match = COST_RE.search(log_text)
    tokens_in = int(tin_match.group(1)) if tin_match else None
    tokens_out = int(tout_match.group(1)) if tout_match else None
    if cost_match:
        cost_usd = round(float(cost_match.group(1)), 6)
    else:
        cost_usd = estimate_cost(model or "", tokens_in, tokens_out) if model else None
    return tokens_in, tokens_out, cost_usd


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

            tokens_in, tokens_out, cost_usd = parse_usage_from_log(
                log_file.read_text(encoding="utf-8"), run.model
            )
            if tokens_in is None and tokens_out is None and cost_usd is None:
                no_result += 1
                print(f"run {run.id}: no usage fields in log")
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
