from flask import Blueprint, jsonify, request, send_file

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.models import SystemAgent, SystemDepartment
from app.services.workspace import COMMON_INPUT, delete_path, list_path, rename_file, workspace_file_path, write_file

files_bp = Blueprint("files", __name__)


@files_bp.get("")
@api_endpoint
@login_required
def get_files():
    path = request.args.get("path", "")
    return jsonify(list_path(path))


@files_bp.get("/raw")
@api_endpoint
@login_required
def get_raw_file():
    target = workspace_file_path(request.args.get("path", ""))
    if target.suffix.lower() != ".pdf":
        raise APIClientError("Only PDF files can be previewed or downloaded this way", 400)
    download = request.args.get("download") == "1"
    return send_file(
        target,
        mimetype="application/pdf",
        as_attachment=download,
        download_name=target.name,
        max_age=0,
    )


@files_bp.post("")
@api_endpoint
@login_required
def create_file():
    payload = request.get_json(force=True) or {}
    path = payload.get("path")
    content = payload.get("content", "")
    if not path:
        raise APIClientError("path is required", 400)
    return jsonify(write_file(path, content)), 201


@files_bp.put("")
@api_endpoint
@login_required
def update_file():
    payload = request.get_json(force=True) or {}
    if payload.get("old_path") and payload.get("new_path"):
        return jsonify(rename_file(payload["old_path"], payload["new_path"]))
    path = payload.get("path")
    if not path:
        raise APIClientError("path is required", 400)
    return jsonify(write_file(path, payload.get("content", "")))


@files_bp.delete("")
@api_endpoint
@login_required
def remove_path():
    payload = request.get_json(force=True) or {}
    path = payload.get("path")
    if not path:
        raise APIClientError("path is required", 400)
    parts = [part for part in str(path).strip().lstrip("/").split("/") if part]
    if not parts:
        raise APIClientError("Cannot delete the workspace root", 400)
    if len(parts) == 1:
        name = parts[0]
        if name == COMMON_INPUT:
            raise APIClientError("Cannot delete the common_input folder", 400)
        if SystemDepartment.query.filter_by(name=name).first():
            raise APIClientError("Cannot delete this folder while the department still exists", 400)
        if SystemAgent.query.filter_by(name=name).first():
            raise APIClientError("Cannot delete this folder while the agent still exists", 400)
    return jsonify(delete_path("/".join(parts)))
