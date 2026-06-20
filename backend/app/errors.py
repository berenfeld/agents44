import logging
from functools import wraps

from flask import Response, jsonify, make_response, request
from marshmallow import ValidationError
from werkzeug.exceptions import HTTPException

from app.middleware.logging import log_api_request, log_api_response

logger = logging.getLogger(__name__)

INTERNAL_ERROR_MESSAGE = "Internal server error"


class APIClientError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class ModelDiscoveryError(RuntimeError):
    pass


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
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        log_api_request()
        try:
            result = view_func(*args, **kwargs)
            response = _coerce_response(result)
            return log_api_response(response)
        except APIClientError as exc:
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
            logger.error(
                "Validation error on %s %s: %s",
                request.method,
                request.path,
                exc.messages,
            )
            response = make_response(jsonify({"error": exc.messages}), 400)
            return log_api_response(response)
        except FileNotFoundError:
            logger.error("Not found on %s %s", request.method, request.path)
            response = make_response(jsonify({"error": "Not found"}), 404)
            return log_api_response(response)
        except HTTPException as exc:
            logger.error(
                "HTTP error on %s %s: %s (status=%s)",
                request.method,
                request.path,
                exc.description or exc.name,
                exc.code or 500,
            )
            return log_api_response(response)
        except Exception:
            logger.exception("Unhandled API error on %s %s", request.method, request.path)
            response = make_response(jsonify({"error": INTERNAL_ERROR_MESSAGE}), 500)
            return log_api_response(response)

    return wrapper
