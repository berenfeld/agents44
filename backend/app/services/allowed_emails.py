import re

from app.errors import APIClientError
from app.extensions import db
from app.models import SystemAllowedEmail

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_allowed_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not email or not EMAIL_RE.fullmatch(email):
        raise APIClientError("Email address is invalid", 400)
    if len(email) > 254:
        raise APIClientError("Email address is too long", 400)
    return email


def list_allowed_emails() -> list[SystemAllowedEmail]:
    return SystemAllowedEmail.query.order_by(SystemAllowedEmail.email).all()


def add_allowed_email(raw_email: str) -> SystemAllowedEmail:
    email = normalize_allowed_email(raw_email)
    if SystemAllowedEmail.query.filter_by(email=email).first():
        raise APIClientError("Email is already allowed", 400)
    row = SystemAllowedEmail(email=email)
    db.session.add(row)
    db.session.flush()
    return row


def delete_allowed_email(row_id: int) -> None:
    row = db.session.get(SystemAllowedEmail, row_id)
    if not row:
        raise APIClientError("Not found", 404)
    db.session.delete(row)


def email_is_allowed(raw_email: str) -> bool:
    email = (raw_email or "").strip().lower()
    if not email:
        return False
    return SystemAllowedEmail.query.filter_by(email=email).first() is not None
