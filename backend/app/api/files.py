import mimetypes

from flask import Blueprint, jsonify, request, send_file

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.models import SystemAgent, SystemDepartment
from app.services.workspace import (
    COMMON_INPUT,
    MAX_UPLOAD_BYTES,
    delete_path,
    list_path,
    protected_path_error,
    rename_file,
    workspace_file_path,
    write_bytes,
    write_file,
)

_PREVIEW_MIMETYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

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
    suffix = target.suffix.lower()
    mimetype = _PREVIEW_MIMETYPES.get(suffix) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    download = request.args.get("download") == "1"
    inline = suffix in _PREVIEW_MIMETYPES and not download
    return send_file(
        target,
        mimetype=mimetype,
        as_attachment=not inline,
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


@files_bp.post("/upload")
@api_endpoint
@login_required
def upload_file():
    uploaded = request.files.get("file")
    if uploaded is None:
        raise APIClientError("file is required", 400)
    filename = (uploaded.filename or "").strip()
    if not filename:
        raise APIClientError("file is required", 400)
    if "/" in filename or "\\" in filename or "\x00" in filename or filename in {".", ".."}:
        raise APIClientError("Invalid file name", 400)
    folder = str(request.form.get("path") or "").strip().strip("/")
    relative = f"{folder}/{filename}" if folder else filename
    content = uploaded.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise APIClientError("File is larger than 50 MB", 400)
    return jsonify(write_bytes(relative, content)), 201


@files_bp.put("")
@api_endpoint
@login_required
def update_file():
    payload = request.get_json(force=True) or {}
    if payload.get("old_path") and payload.get("new_path"):
        blocked = protected_path_error(str(payload["old_path"]), action="rename")
        if blocked:
            raise APIClientError(blocked, 400)
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
    blocked = protected_path_error("/".join(parts), action="delete")
    if blocked:
        raise APIClientError(blocked, 400)
    if len(parts) == 1:
        name = parts[0]
        if name == COMMON_INPUT:
            raise APIClientError("Cannot delete the common_input folder", 400)
        if SystemDepartment.query.filter_by(name=name).first():
            raise APIClientError("Cannot delete this folder while the department still exists", 400)
    if len(parts) == 2:
        department_name, agent_name = parts
        if SystemAgent.query.filter_by(department=department_name, name=agent_name).first():
            raise APIClientError("Cannot delete this folder while the agent still exists", 400)
    return jsonify(delete_path("/".join(parts)))
