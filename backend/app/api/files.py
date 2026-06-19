from flask import Blueprint, jsonify, request

from app.auth import login_required
from app.errors import APIClientError, api_endpoint
from app.services.workspace import delete_file, list_path, rename_file, write_file

files_bp = Blueprint("files", __name__)


@files_bp.get("")
@api_endpoint
@login_required
def get_files():
    path = request.args.get("path", "")
    return jsonify(list_path(path))


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
def remove_file():
    payload = request.get_json(force=True) or {}
    path = payload.get("path")
    if not path:
        raise APIClientError("path is required", 400)
    return jsonify(delete_file(path))
