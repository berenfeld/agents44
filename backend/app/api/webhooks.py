from flask import Blueprint, Response, jsonify, request

from app.errors import APIClientError, api_endpoint
from app.services.agent_runner import start_agent
from app.services.whatsapp import ingest_whatsapp_webhook, verify_whatsapp_webhook

webhooks_bp = Blueprint("webhooks", __name__)


@webhooks_bp.get("/whatsapp/<secret>")
@api_endpoint
def whatsapp_webhook_verify(secret: str):
    mode = (request.args.get("hub.mode") or "").strip()
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")
    if mode != "subscribe" or not verify_whatsapp_webhook(secret, token):
        raise APIClientError("Forbidden", 403)
    return Response(challenge or "", mimetype="text/plain")


@webhooks_bp.post("/whatsapp/<secret>")
@api_endpoint
def whatsapp_webhook(secret: str):
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        raise APIClientError("JSON body is required", 400)

    result = ingest_whatsapp_webhook(secret, payload)
    if result.get("triggered"):
        start_agent(result["agent_id"], "whatsapp", payload=result.get("payload"))
    return jsonify({"ok": True})
