from flask import Blueprint, jsonify, request

from app.errors import APIClientError, api_endpoint
from app.services.agent_runner import start_agent
from app.services.whatsapp import ingest_wati_webhook

webhooks_bp = Blueprint("webhooks", __name__)


@webhooks_bp.post("/wati/<secret>")
@api_endpoint
def wati_webhook(secret: str):
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        raise APIClientError("JSON body is required", 400)

    result = ingest_wati_webhook(secret, payload)
    if result.get("triggered"):
        start_agent(result["agent_id"], "whatsapp", payload=result.get("payload"))
    return jsonify({"ok": True})
