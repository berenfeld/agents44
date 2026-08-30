from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from marshmallow import EXCLUDE, Schema, ValidationError, fields, pre_load, validate

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.extensions import db
from app.models import SystemAgent, SystemAgentRun, SystemDepartment
from app.models.run_status import RunStatus
from app.services.model_registry import validate_model
from app.services.scheduler import sync_scheduler_jobs
from app.services.timeout import parse_timeout_input
from app.services.params import get_timeout_sigkill_grace_seconds, get_timeout_sigterm_grace_seconds
from app.services.db_provisioning import (
    create_agent_role,
    drop_agent_db_access,
    refresh_all_cross_grants,
)
from app.services.workspace import ensure_agent_folder

agents_bp = Blueprint("agents", __name__)


class AgentSchema(Schema):
    class Meta:
        unknown = EXCLUDE

    name = fields.Str(required=True, validate=validate.Length(min=1, max=128))
    department = fields.Str(required=True, validate=validate.Length(min=1, max=128))
    model = fields.Str(required=True)
    crond = fields.Str(allow_none=True)
    enabled = fields.Bool(load_default=True)
    timeout_seconds = fields.Int(load_default=300, validate=validate.Range(min=1, max=86400))
    timeout = fields.Raw(load_only=True, required=False)

    @pre_load
    def normalize_timeout(self, data, **kwargs):
        if not isinstance(data, dict):
            return data
        payload = dict(data)
        timeout_label = payload.pop("timeout", None)
        if timeout_label is not None and str(timeout_label).strip() and "timeout_seconds" not in payload:
            if isinstance(timeout_label, int):
                payload["timeout_seconds"] = timeout_label
            else:
                parsed = parse_timeout_input(str(timeout_label))
                if parsed is None:
                    raise ValidationError({"timeout": ["Use mm:ss (e.g. 5:00) or seconds"]})
                payload["timeout_seconds"] = parsed
        return payload


def _require_department(name: str) -> str:
    department = name.strip().lower()
    if not SystemDepartment.query.filter_by(name=department).first():
        raise APIClientError("Department not found", 400)
    return department


def _runs_by_agent_status(status: RunStatus) -> dict[int, SystemAgentRun]:
    runs = SystemAgentRun.query.filter_by(status=status).order_by(SystemAgentRun.id.asc()).all()
    return {run.agent_id: run for run in runs}


def _active_run_dict(run: SystemAgentRun, agent: SystemAgent) -> dict:
    from app.services.agent_runner import get_active_run_timeout

    elapsed = (datetime.now(timezone.utc) - run.started_at).total_seconds() if run.started_at else 0
    timeout = get_active_run_timeout(run.id)
    if timeout is None:
        timeout = agent.timeout_seconds
    sigterm_grace_seconds = get_timeout_sigterm_grace_seconds()
    sigkill_grace_seconds = get_timeout_sigkill_grace_seconds()
    return {
        "id": run.id,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "elapsed_seconds": round(elapsed, 1),
        "timeout_seconds": timeout,
        "timeout_sigterm_grace_seconds": sigterm_grace_seconds,
        "timeout_sigkill_grace_seconds": sigkill_grace_seconds,
        "timeout_sigterm_at_seconds": timeout + sigterm_grace_seconds,
        "timeout_sigkill_at_seconds": timeout + sigkill_grace_seconds,
    }


@agents_bp.get("")
@api_endpoint
@login_required
def list_agents():
    agents = SystemAgent.query.order_by(SystemAgent.name).all()
    running_runs = _runs_by_agent_status(RunStatus.running)
    pending_runs = _runs_by_agent_status(RunStatus.pending)
    payload = []
    for agent in agents:
        item = {
            **agent.to_dict(),
            "is_running": agent.id in running_runs,
            "is_pending": agent.id in pending_runs,
        }
        running_run = running_runs.get(agent.id)
        if running_run:
            item["active_run"] = _active_run_dict(running_run, agent)
        payload.append(item)
    return jsonify(payload)


@agents_bp.post("")
@api_endpoint
@login_required
def create_agent():
    data = AgentSchema().load(request.get_json(force=True) or {})
    if not validate_model(data["model"]):
        raise APIClientError("Unsupported model", 400)
    if SystemAgent.query.filter_by(name=data["name"]).first():
        raise APIClientError("Agent name already exists", 400)

    department = _require_department(data["department"])
    conn = db.session.connection()
    creds = create_agent_role(conn, agent_name=data["name"], department=department)

    agent = SystemAgent(
        name=data["name"],
        department=department,
        model=data["model"],
        crond=data.get("crond"),
        enabled=data.get("enabled", True),
        timeout_seconds=data.get("timeout_seconds", 300),
        db_user=creds["db_user"],
        db_password=creds["db_password"],
    )
    db.session.add(agent)
    db.session.flush()
    refresh_all_cross_grants(conn)
    ensure_agent_folder(agent.name)
    sync_scheduler_jobs()
    return jsonify(agent.to_dict()), 201


@agents_bp.get("/<int:agent_id>")
@api_endpoint
@login_required
def get_agent(agent_id: int):
    agent = db.session.get(SystemAgent, agent_id)
    if not agent:
        raise APIClientError("Not found", 404)
    return jsonify(agent.to_dict())


@agents_bp.put("/<int:agent_id>")
@api_endpoint
@login_required
def update_agent(agent_id: int):
    agent = db.session.get(SystemAgent, agent_id)
    if not agent:
        raise APIClientError("Not found", 404)
    data = AgentSchema(partial=True).load(request.get_json(force=True) or {})
    if "name" in data and data["name"] != agent.name:
        raise APIClientError("Agent name cannot be changed", 400)
    if "department" in data and data["department"] != agent.department:
        raise APIClientError("Department cannot be changed", 400)
    if "model" in data and not validate_model(data["model"]):
        raise APIClientError("Unsupported model", 400)
    previous_timeout = agent.timeout_seconds
    for key, value in data.items():
        setattr(agent, key, value)
    if "timeout_seconds" in data and data["timeout_seconds"] != previous_timeout:
        from app.services.agent_runner import sync_agent_run_timeout

        sync_agent_run_timeout(agent_id, data["timeout_seconds"])
    sync_scheduler_jobs()
    return jsonify(agent.to_dict())


@agents_bp.delete("/<int:agent_id>")
@api_endpoint
@login_required
def delete_agent(agent_id: int):
    agent = db.session.get(SystemAgent, agent_id)
    if not agent:
        raise APIClientError("Not found", 404)
    conn = db.session.connection()
    drop_agent_db_access(conn, agent_name=agent.name, db_user=agent.db_user)
    db.session.delete(agent)
    db.session.flush()
    refresh_all_cross_grants(conn)
    sync_scheduler_jobs()
    return jsonify({"deleted": agent_id})


@agents_bp.post("/<int:agent_id>/trigger")
@api_endpoint
@login_required
def trigger_agent(agent_id: int):
    from app.services.agent_runner import start_agent

    payload = (request.get_json(silent=True) or {}).get("payload")
    run = start_agent(agent_id, "manual", payload=payload)
    status_code = 202 if run.status.value == "pending" else 200
    return jsonify(run.to_dict()), status_code
