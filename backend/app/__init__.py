import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from app.api.agent_db import agent_db_bp
from app.api.agents import agents_bp
from app.api.auth_routes import auth_bp, params_bp
from app.api.departments import departments_bp
from app.api.files import files_bp
from app.api.runs import models_bp, runs_bp
from app.config import Config
from app.errors import api_endpoint
from app.extensions import db
from app.mcp_server.server import start_mcp_server
from app.services.model_registry import init_model_registry
from app.services.params import seed_system_params
from app.services.scheduler import init_scheduler
from app.services.workspace import ensure_workspace_layout
from app.version import app_version

logger = logging.getLogger(__name__)


def _should_start_background_services(app: Flask) -> bool:
    if not app.debug:
        return True
    return os.environ.get("WERKZEUG_RUN_MAIN") == "true"


_flask_app = None


def get_app() -> Flask:
    global _flask_app
    if _flask_app is None:
        _flask_app = create_app()
    return _flask_app


def _configure_logging(log_dir: str) -> None:
    Path(log_dir).mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    if not any(isinstance(handler, logging.StreamHandler) for handler in root.handlers):
        stream_handler = logging.StreamHandler(sys.stderr)
        stream_handler.setFormatter(formatter)
        root.addHandler(stream_handler)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    _configure_logging(app.config["LOG_DIR"])

    CORS(app, supports_credentials=True, origins=["http://localhost:3000", "https://agents.catch44.co.il"])

    db.init_app(app)

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(agents_bp, url_prefix="/api/agents")
    app.register_blueprint(runs_bp, url_prefix="/api/runs")
    app.register_blueprint(models_bp, url_prefix="/api/models")
    app.register_blueprint(departments_bp, url_prefix="/api/departments")
    app.register_blueprint(agent_db_bp, url_prefix="/api/agent-db")
    app.register_blueprint(files_bp, url_prefix="/api/files")
    app.register_blueprint(params_bp, url_prefix="/api/system-params")

    @app.before_request
    def enforce_json_for_mutations():
        if not request.path.startswith("/api/"):
            return None
        if request.path.startswith("/api/auth/google") or request.path.startswith("/api/auth/callback"):
            return None
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            if request.content_length and request.mimetype != "application/json":
                return jsonify({"error": "Content-Type must be application/json"}), 415
        return None

    @app.get("/api/health")
    @api_endpoint
    def health():
        return jsonify(
            {
                "ok": True,
                "version": app_version(),
                "utc": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.get("/api/docs")
    @api_endpoint
    def api_docs():
        return jsonify(
            {
                "openapi": "3.0.0",
                "info": {"title": "Agents44 API", "version": "1.0.0"},
                "paths": {
                    "/api/agents": {"get": {}, "post": {}},
                    "/api/departments": {"get": {}, "post": {}, "delete": {}},
                    "/api/runs": {"get": {}},
                    "/api/models": {"get": {}},
                    "/api/files": {"get": {}, "post": {}, "put": {}, "delete": {}},
                },
            }
        )

    with app.app_context():
        db.create_all()
        seed_system_params()
        ensure_workspace_layout()
        init_model_registry(app)
        if _should_start_background_services(app):
            if not app.config.get("SCHEDULER_STARTED"):
                init_scheduler(app)
                app.config["SCHEDULER_STARTED"] = True
            if not app.config.get("MCP_STARTED"):
                start_mcp_server(app, app.config["MCP_PORT"])
                app.config["MCP_STARTED"] = True

    global _flask_app
    _flask_app = app
    return app
