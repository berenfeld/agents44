import logging
from functools import wraps

from flask import Response, jsonify, make_response, request
from marshmallow import ValidationError
from werkzeug.exceptions import HTTPException

from app.extensions import db
from app.middleware.logging import log_api_request, log_api_response

logger = logging.getLogger(__name__)

INTERNAL_ERROR_MESSAGE = "Internal server error"
_AFTER_COMMIT_KEY = "after_commit_callbacks"


class APIClientError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class ModelDiscoveryError(RuntimeError):
    pass


def register_after_commit(callback) -> None:
    """Queue work to run after `@api_endpoint` commits (e.g. enqueue a worker)."""
    hooks = db.session.info.setdefault(_AFTER_COMMIT_KEY, [])
    hooks.append(callback)


def _pop_after_commit_callbacks() -> list:
    return list(db.session.info.pop(_AFTER_COMMIT_KEY, []) or [])


def _run_after_commit_callbacks(callbacks: list) -> None:
    for callback in callbacks:
        try:
            callback()
        except Exception:  # noqa: BLE001 — commit already succeeded; log and continue
            logger.exception("after_commit callback failed")


def _coerce_response(result):
    if isinstance(result, Response):
        return result
    if isinstance(result, tuple):
        response = make_response(result[0], result[1] if len(result) > 1 else 200)
        if len(result) > 2:
            response.headers.extend(result[2])
        return response
    return result


def api_endpoint(view_func):
    """Run every API view in one DB transaction: commit on success, rollback on any error.

    Unhandled exceptions are logged with a full stack trace and returned as 500.
    Views must not catch-and-continue; raise APIClientError for expected 4xx.
    """

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        log_api_request()
        try:
            result = view_func(*args, **kwargs)
            response = _coerce_response(result)
            callbacks = _pop_after_commit_callbacks()
            db.session.commit()
            _run_after_commit_callbacks(callbacks)
            return log_api_response(response)
        except APIClientError as exc:
            _pop_after_commit_callbacks()
            db.session.rollback()
            logger.error(
                "API client error on %s %s: %s (status=%s)",
                request.method,
                request.path,
                exc.message,
                exc.status_code,
            )
            response = make_response(jsonify({"error": exc.message}), exc.status_code)
            return log_api_response(response)
        except ValidationError as exc:
            _pop_after_commit_callbacks()
            db.session.rollback()
            logger.error(
                "Validation error on %s %s: %s",
                request.method,
                request.path,
                exc.messages,
            )
            response = make_response(jsonify({"error": exc.messages}), 400)
            return log_api_response(response)
        except FileNotFoundError:
            _pop_after_commit_callbacks()
            db.session.rollback()
            logger.error("Not found on %s %s", request.method, request.path)
            response = make_response(jsonify({"error": "Not found"}), 404)
            return log_api_response(response)
        except HTTPException as exc:
            _pop_after_commit_callbacks()
            db.session.rollback()
            logger.error(
                "HTTP error on %s %s: %s (status=%s)",
                request.method,
                request.path,
                exc.description or exc.name,
                exc.code or 500,
            )
            response = make_response(
                jsonify({"error": exc.description or exc.name}),
                exc.code or 500,
            )
            return log_api_response(response)
        except Exception:
            _pop_after_commit_callbacks()
            db.session.rollback()
            logger.exception("Unhandled API error on %s %s", request.method, request.path)
            response = make_response(jsonify({"error": INTERNAL_ERROR_MESSAGE}), 500)
            return log_api_response(response)

    return wrapper
