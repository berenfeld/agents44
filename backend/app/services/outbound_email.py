import json
import logging
import re
import smtplib
import threading
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

from flask import current_app
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import joinedload

from app.errors import APIClientError
from app.extensions import db
from app.models import (
    EmailContentType,
    EmailSendingStatus,
    SystemAgent,
    SystemDepartment,
    SystemEmailConf,
    SystemEmailMessage,
)
from app.services.params import get_param_int

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_SUBJECT_LEN = 998
MAX_MESSAGE_LEN = 500_000
MAX_ADDRESS_LIST = 50
DEFAULT_SEND_INTERVAL_SECONDS = 300
DEFAULT_GIVE_UP_SECONDS = 86400

_email_wakeup = threading.Event()
_email_thread: threading.Thread | None = None


def wake_email_sender() -> None:
    _email_wakeup.set()


def department_email_provisioned(department: SystemDepartment) -> bool:
    return bool(department.email_conf and department.email_conf.email_address and department.email_conf.app_password)


def normalize_email_address(raw: str) -> str:
    value = (raw or "").strip().lower()
    if not value or not EMAIL_RE.fullmatch(value):
        raise APIClientError("Email address is invalid", 400)
    if len(value) > 254:
        raise APIClientError("Email address is too long", 400)
    return value


def validate_google_app_password(raw: str) -> str:
    value = re.sub(r"\s+", "", raw or "")
    if len(value) != 16 or not value.isalnum():
        raise APIClientError("Google app password must be 16 characters (spaces allowed)", 400)
    return value


def coerce_email_list(value, *, field_name: str, required: bool = False) -> list[str]:
    if value is None:
        items: list[str] = []
    elif isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise APIClientError(f"{field_name} must be a list of email addresses", 400) from exc
            if not isinstance(parsed, list):
                raise APIClientError(f"{field_name} must be a list of email addresses", 400)
            items = [str(item) for item in parsed]
        else:
            items = [part.strip() for part in stripped.split(",") if part.strip()]
    elif isinstance(value, (list, tuple)):
        items = [str(item) for item in value]
    else:
        raise APIClientError(f"{field_name} must be a list of email addresses", 400)

    emails: list[str] = []
    seen: set[str] = set()
    for item in items:
        address = normalize_email_address(item)
        if address in seen:
            continue
        seen.add(address)
        emails.append(address)
    if required and not emails:
        raise APIClientError(f"{field_name} is required", 400)
    if len(emails) > MAX_ADDRESS_LIST:
        raise APIClientError(f"{field_name} has too many addresses (max {MAX_ADDRESS_LIST})", 400)
    return emails


def normalize_content_type(raw: str | None) -> EmailContentType:
    value = (raw or EmailContentType.html.value).strip().lower()
    if value in {"html", "text/html"}:
        return EmailContentType.html
    if value in {"plain", "text", "text/plain"}:
        return EmailContentType.plain
    raise APIClientError("content_type must be html or plain", 400)


def normalize_sending_status(raw: str) -> EmailSendingStatus:
    value = (raw or "").strip().lower()
    allowed = {item.value: item for item in EmailSendingStatus}
    if value not in allowed:
        raise APIClientError("sending_status must be pending, sent, fail, or canceled", 400)
    return allowed[value]


def _conf_for_department(department: SystemDepartment) -> SystemEmailConf:
    if not department_email_provisioned(department):
        raise APIClientError("Department is not provisioned for email", 400)
    assert department.email_conf is not None
    return department.email_conf


def _department_for_agent(agent: SystemAgent) -> SystemDepartment:
    department = SystemDepartment.query.filter_by(name=agent.department).first()
    if not department:
        raise APIClientError("Department not found", 404)
    _conf_for_department(department)
    return department


def provision_department_email(
    department: SystemDepartment,
    *,
    email_address: str,
    app_password: str,
) -> SystemEmailConf:
    if department_email_provisioned(department):
        raise APIClientError("Email is already provisioned for this department", 400)

    stored_email = normalize_email_address(email_address)
    stored_password = validate_google_app_password(app_password)

    taken = SystemEmailConf.query.filter(
        func.lower(SystemEmailConf.email_address) == stored_email,
        SystemEmailConf.department_id != department.id,
    ).first()
    if taken:
        raise APIClientError("This email address is already used by another department", 400)

    conf = SystemEmailConf(
        department_id=department.id,
        email_address=stored_email,
        app_password=stored_password,
    )
    department.email_conf = conf
    db.session.add(conf)
    db.session.flush()
    return conf


def unprovision_department_email(department: SystemDepartment) -> None:
    if not department_email_provisioned(department):
        raise APIClientError("Email is not provisioned for this department", 400)
    db.session.delete(department.email_conf)
    department.email_conf = None


def queue_agent_email(
    agent: SystemAgent,
    *,
    source_email: str,
    subject: str,
    recipients,
    message: str,
    cc=None,
    bcc=None,
    content_type: str | None = None,
) -> dict:
    department = _department_for_agent(agent)
    conf = _conf_for_department(department)
    from_email = normalize_email_address(source_email)
    if from_email != conf.email_address:
        raise APIClientError(
            f"source_email must be this department's provisioned address ({conf.email_address})",
            400,
        )

    subject_text = (subject or "").strip()
    if not subject_text:
        raise APIClientError("Subject is required", 400)
    if len(subject_text) > MAX_SUBJECT_LEN:
        raise APIClientError("Subject is too long", 400)

    body = message if message is not None else ""
    if not str(body).strip():
        raise APIClientError("Message is required", 400)
    if len(body) > MAX_MESSAGE_LEN:
        raise APIClientError("Message is too long", 400)

    to_list = coerce_email_list(recipients, field_name="recipients", required=True)
    cc_list = coerce_email_list(cc, field_name="cc")
    bcc_list = coerce_email_list(bcc, field_name="bcc")
    if len(to_list) + len(cc_list) + len(bcc_list) > MAX_ADDRESS_LIST:
        raise APIClientError(f"Too many addresses across to/cc/bcc (max {MAX_ADDRESS_LIST})", 400)

    row = SystemEmailMessage(
        agent_id=agent.id,
        from_email=from_email,
        subject=subject_text,
        recipients=to_list,
        cc=cc_list,
        bcc=bcc_list,
        message=body,
        content_type=normalize_content_type(content_type),
        sending_status=EmailSendingStatus.pending,
    )
    db.session.add(row)
    db.session.flush()
    db.session.refresh(row)
    return {"id": row.id, "sending_status": row.sending_status.value}


def list_agent_emails(agent_id: int) -> list[dict]:
    rows = (
        SystemEmailMessage.query.filter_by(agent_id=agent_id)
        .order_by(SystemEmailMessage.id.desc())
        .limit(500)
        .all()
    )
    return [row.to_agent_dict() for row in rows]


def list_operator_emails(
    *,
    agent_id: int | None = None,
    address: str | None = None,
    subject: str | None = None,
    content: str | None = None,
) -> list[dict]:
    query = SystemEmailMessage.query.options(joinedload(SystemEmailMessage.agent))
    if agent_id is not None:
        query = query.filter(SystemEmailMessage.agent_id == agent_id)
    address_term = (address or "").strip()
    if address_term:
        like = f"%{address_term}%"
        query = query.filter(
            or_(
                SystemEmailMessage.from_email.ilike(like),
                cast(SystemEmailMessage.recipients, String).ilike(like),
                cast(SystemEmailMessage.cc, String).ilike(like),
                cast(SystemEmailMessage.bcc, String).ilike(like),
            )
        )
    subject_term = (subject or "").strip()
    if subject_term:
        query = query.filter(SystemEmailMessage.subject.ilike(f"%{subject_term}%"))
    content_term = (content or "").strip()
    if content_term:
        query = query.filter(SystemEmailMessage.message.ilike(f"%{content_term}%"))
    rows = query.order_by(SystemEmailMessage.id.desc()).all()
    return [row.to_dict() for row in rows]


def get_operator_email(message_id: int) -> SystemEmailMessage:
    row = (
        SystemEmailMessage.query.options(joinedload(SystemEmailMessage.agent))
        .filter_by(id=message_id)
        .first()
    )
    if not row:
        raise APIClientError("Email not found", 404)
    return row


def update_operator_email(row: SystemEmailMessage, data: dict) -> SystemEmailMessage:
    if "from_email" in data:
        row.from_email = normalize_email_address(data["from_email"])
    if "subject" in data:
        subject_text = (data["subject"] or "").strip()
        if not subject_text:
            raise APIClientError("Subject is required", 400)
        if len(subject_text) > MAX_SUBJECT_LEN:
            raise APIClientError("Subject is too long", 400)
        row.subject = subject_text
    if "recipients" in data:
        row.recipients = coerce_email_list(data["recipients"], field_name="recipients", required=True)
    if "cc" in data:
        row.cc = coerce_email_list(data["cc"], field_name="cc")
    if "bcc" in data:
        row.bcc = coerce_email_list(data["bcc"], field_name="bcc")
    if "message" in data:
        body = data["message"] if data["message"] is not None else ""
        if not str(body).strip():
            raise APIClientError("Message is required", 400)
        if len(body) > MAX_MESSAGE_LEN:
            raise APIClientError("Message is too long", 400)
        row.message = body
    if "content_type" in data:
        row.content_type = normalize_content_type(data["content_type"])
    if "sending_status" in data:
        row.sending_status = normalize_sending_status(data["sending_status"])
        if row.sending_status == EmailSendingStatus.pending:
            row.error_message = None
    to_list = list(row.recipients or [])
    cc_list = list(row.cc or [])
    bcc_list = list(row.bcc or [])
    if not to_list:
        raise APIClientError("recipients is required", 400)
    if len(to_list) + len(cc_list) + len(bcc_list) > MAX_ADDRESS_LIST:
        raise APIClientError(f"Too many addresses across to/cc/bcc (max {MAX_ADDRESS_LIST})", 400)
    db.session.flush()
    return row


def build_email_instructions(department_name: str) -> str:
    department = SystemDepartment.query.filter_by(name=department_name).first()
    if not department or not department_email_provisioned(department):
        return ""
    from_email = department.email_conf.email_address if department.email_conf else ""
    return "\n".join(
        [
            "# Email",
            "",
            f"This department can send email from `{from_email}` using a Google app password.",
            "Use `send_email` to queue a message and `list_emails` to inspect this agent's mail and `sending_status`.",
            "Prefer HTML for `message` (`content_type` html). Plain text is allowed.",
            "Do not read or write email tables with `read_db` / `write_db`.",
            "Only this agent's emails are visible. Sending is asynchronous; an operator tracks every message.",
            f"Always pass `source_email` as `{from_email}`.",
        ]
    )


def _envelope_addresses(row: SystemEmailMessage) -> list[str]:
    addresses: list[str] = []
    seen: set[str] = set()
    for item in list(row.recipients or []) + list(row.cc or []) + list(row.bcc or []):
        address = str(item).strip().lower()
        if not address or address in seen:
            continue
        seen.add(address)
        addresses.append(address)
    if not addresses:
        raise APIClientError("Email has no recipients", 400)
    return addresses


def _lookup_conf(from_email: str) -> SystemEmailConf:
    conf = SystemEmailConf.query.filter(func.lower(SystemEmailConf.email_address) == from_email.lower()).first()
    if not conf:
        raise APIClientError("No email configuration for this from address", 400)
    return conf


def _deliver_email(row: SystemEmailMessage) -> None:
    conf = _lookup_conf(row.from_email)
    subtype = "html" if row.content_type == EmailContentType.html else "plain"
    msg = MIMEText(row.message or "", subtype, "utf-8")
    msg["Subject"] = row.subject or ""
    msg["From"] = conf.email_address
    msg["To"] = ", ".join(row.recipients or [])
    if row.cc:
        msg["Cc"] = ", ".join(row.cc)
    envelope = _envelope_addresses(row)
    host = current_app.config.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(current_app.config.get("SMTP_PORT") or 587)
    with smtplib.SMTP(host, port, timeout=30) as server:
        server.starttls()
        server.login(conf.email_address, conf.app_password)
        server.sendmail(conf.email_address, envelope, msg.as_string())


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _send_one_pending(row: SystemEmailMessage, *, now: datetime, give_up: timedelta) -> None:
    created = _aware(row.created_at) or now
    expired = now - created >= give_up
    try:
        _deliver_email(row)
        row.sending_status = EmailSendingStatus.sent
        row.sent_at = now
        row.last_attempt_at = now
        row.attempt_count = (row.attempt_count or 0) + 1
        row.error_message = None
    except APIClientError as exc:
        row.last_attempt_at = now
        row.attempt_count = (row.attempt_count or 0) + 1
        row.error_message = exc.message
        if expired:
            row.sending_status = EmailSendingStatus.fail
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        row.last_attempt_at = now
        row.attempt_count = (row.attempt_count or 0) + 1
        row.error_message = str(exc)[:1000]
        if expired:
            row.sending_status = EmailSendingStatus.fail


def process_pending_emails() -> None:
    give_up_seconds = max(get_param_int("EMAIL_SEND_GIVE_UP_SECONDS", DEFAULT_GIVE_UP_SECONDS), 1)
    give_up = timedelta(seconds=give_up_seconds)
    now = datetime.now(timezone.utc)
    rows = (
        SystemEmailMessage.query.filter_by(sending_status=EmailSendingStatus.pending)
        .order_by(SystemEmailMessage.id.asc())
        .all()
    )
    for row in rows:
        _send_one_pending(row, now=now, give_up=give_up)
        db.session.commit()


def init_email_sender(app) -> None:
    global _email_thread
    if _email_thread and _email_thread.is_alive():
        return

    def _loop() -> None:
        while True:
            interval = DEFAULT_SEND_INTERVAL_SECONDS
            _email_wakeup.clear()
            try:
                with app.app_context():
                    interval = max(get_param_int("EMAIL_SEND_INTERVAL_SECONDS", DEFAULT_SEND_INTERVAL_SECONDS), 1)
                    process_pending_emails()
            except Exception:
                logger.exception("Email sender loop failed")
            _email_wakeup.wait(timeout=interval)

    _email_thread = threading.Thread(target=_loop, daemon=True, name="email-sender")
    _email_thread.start()
    wake_email_sender()
    logger.info("Email sender started")
