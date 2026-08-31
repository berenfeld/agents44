from flask import Blueprint, jsonify, request
from sqlalchemy.orm import joinedload

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.extensions import db
from app.models import SystemAgentRun
from app.models.run_status import RunStatus
from app.services.model_registry import get_default_model, get_supported_models
from app.services.workspace import RUN_SUMMARY_FILE, workspace_root

runs_bp = Blueprint("runs", __name__)
models_bp = Blueprint("models", __name__)


def _parse_run_status_filter(raw: str | None) -> list[RunStatus] | None:
    text = (raw or "").strip()
    if not text:
        return None
    wanted = [item.strip() for item in text.split(",") if item.strip()]
    if not wanted:
        raise APIClientError("Invalid run status", 400)
    allowed = {status.value: status for status in RunStatus}
    unknown = [item for item in wanted if item not in allowed]
    if unknown:
        raise APIClientError("Invalid run status", 400)
    return [allowed[item] for item in wanted]


@models_bp.get("")
@api_endpoint
@login_required
def list_models():
    return jsonify({"models": get_supported_models(), "default": get_default_model()})


@runs_bp.get("")
@api_endpoint
@login_required
def list_runs():
    page = max(int(request.args.get("page", 1)), 1)
    per_page = min(max(int(request.args.get("per_page", 50)), 1), 200)
    statuses = _parse_run_status_filter(request.args.get("status"))
    query = SystemAgentRun.query.options(joinedload(SystemAgentRun.agent)).order_by(SystemAgentRun.id.desc())
    if statuses:
        query = query.filter(SystemAgentRun.status.in_(statuses))
    pagination = db.paginate(query, page=page, per_page=per_page, error_out=False)
    return jsonify(
        {
            "items": [run.to_dict() for run in pagination.items],
            "page": page,
            "per_page": per_page,
            "total": pagination.total,
        }
    )


@runs_bp.get("/<int:run_id>")
@api_endpoint
@login_required
def get_run(run_id: int):
    run = db.session.get(SystemAgentRun, run_id)
    if not run:
        raise APIClientError("Not found", 404)
    return jsonify(run.to_dict())


@runs_bp.get("/<int:run_id>/log")
@api_endpoint
@login_required
def get_run_log(run_id: int):
    run = db.session.get(SystemAgentRun, run_id)
    if not run:
        raise APIClientError("Not found", 404)
    if not run.log_path:
        return jsonify({"log": ""})
    log_file = workspace_root() / run.log_path
    if not log_file.exists():
        return jsonify({"log": ""})
    return jsonify({"log": log_file.read_text(encoding="utf-8")})


@runs_bp.get("/<int:run_id>/prompt")
@api_endpoint
@login_required
def get_run_prompt(run_id: int):
    run = db.session.get(SystemAgentRun, run_id)
    if not run:
        raise APIClientError("Not found", 404)
    if not run.prompt_path:
        return jsonify({"prompt": ""})
    prompt_file = workspace_root() / run.prompt_path
    if not prompt_file.exists():
        return jsonify({"prompt": ""})
    return jsonify({"prompt": prompt_file.read_text(encoding="utf-8")})


@runs_bp.get("/<int:run_id>/summary")
@api_endpoint
@login_required
def get_run_summary(run_id: int):
    run = db.session.get(SystemAgentRun, run_id)
    if not run:
        raise APIClientError("Not found", 404)
    if not run.run_dir:
        return jsonify({"summary": ""})
    summary_file = workspace_root() / run.run_dir / RUN_SUMMARY_FILE
    if not summary_file.exists():
        return jsonify({"summary": ""})
    return jsonify({"summary": summary_file.read_text(encoding="utf-8")})


@runs_bp.delete("/<int:run_id>")
@api_endpoint
@login_required
def delete_run(run_id: int):
    run = db.session.get(SystemAgentRun, run_id)
    if not run:
        raise APIClientError("Not found", 404)
    if run.status in (RunStatus.pending, RunStatus.running):
        raise APIClientError("Stop the run before deleting it", 400)
    db.session.delete(run)
    return jsonify({"deleted": run_id})


@runs_bp.post("/<int:run_id>/stop")
@api_endpoint
@login_required
def stop_run_endpoint(run_id: int):
    from app.services.agent_runner import stop_run

    run = stop_run(run_id)
    return jsonify(run.to_dict())
