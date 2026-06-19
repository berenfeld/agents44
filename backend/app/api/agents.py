from flask import Blueprint, jsonify, request
from marshmallow import Schema, fields, validate

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.extensions import db
from app.models import SystemAgent, SystemDepartment
from app.services.model_registry import validate_model
from app.services.scheduler import sync_scheduler_jobs
from app.services.workspace import ensure_agent_folder

agents_bp = Blueprint("agents", __name__)


class AgentSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=128))
    department = fields.Str(required=True, validate=validate.Length(min=1, max=128))
    model = fields.Str(required=True)
    crond = fields.Str(allow_none=True)
    enabled = fields.Bool(load_default=True)
    timeout_seconds = fields.Int(load_default=300, validate=validate.Range(min=1, max=86400))


def _require_department(name: str) -> str:
    department = name.strip().lower()
    if not SystemDepartment.query.filter_by(name=department).first():
        raise APIClientError("Department not found", 400)
    return department


@agents_bp.get("")
@api_endpoint
@login_required
def list_agents():
    agents = SystemAgent.query.order_by(SystemAgent.name).all()
    return jsonify([a.to_dict() for a in agents])


@agents_bp.post("")
@api_endpoint
@login_required
def create_agent():
    data = AgentSchema().load(request.get_json(force=True) or {})
    if not validate_model(data["model"]):
        raise APIClientError("Unsupported model", 400)
    if SystemAgent.query.filter_by(name=data["name"]).first():
        raise APIClientError("Agent name already exists", 400)

    agent = SystemAgent(
        name=data["name"],
        department=_require_department(data["department"]),
        model=data["model"],
        crond=data.get("crond"),
        enabled=data.get("enabled", True),
        timeout_seconds=data.get("timeout_seconds", 300),
    )
    db.session.add(agent)
    db.session.commit()
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
    for key, value in data.items():
        setattr(agent, key, value)
    db.session.commit()
    sync_scheduler_jobs()
    return jsonify(agent.to_dict())


@agents_bp.delete("/<int:agent_id>")
@api_endpoint
@login_required
def delete_agent(agent_id: int):
    agent = db.session.get(SystemAgent, agent_id)
    if not agent:
        raise APIClientError("Not found", 404)
    db.session.delete(agent)
    db.session.commit()
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
