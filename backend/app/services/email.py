import logging
import smtplib
from email.mime.text import MIMEText

from flask import current_app

logger = logging.getLogger(__name__)


def send_email(subject: str, body: str, to_email: str | None = None) -> None:
    admin = to_email or current_app.config["ADMIN_EMAIL"]
    configured_admin = current_app.config["ADMIN_EMAIL"]
    if admin != configured_admin:
        raise ValueError("Email recipient is restricted to admin address")

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = current_app.config["SMTP_USER"]
    msg["To"] = admin

    host = current_app.config["SMTP_HOST"]
    port = current_app.config["SMTP_PORT"]
    user = current_app.config["SMTP_USER"]
    password = current_app.config["SMTP_APP_PASSWORD"]

    if not user or not password:
        logger.warning("SMTP not configured; skipping email: %s", subject)
        return

    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(user, [admin], msg.as_string())


def maybe_notify_run(agent_name: str, run_id: int, status: str, error: str | None = None) -> None:
    from app.services.params import get_param

    notify_on = (get_param("NOTIFY_ON", "failures") or "failures").lower()
    if notify_on == "none":
        return
    if notify_on == "failures" and status != "failed":
        return

    subject = f"Agent run {status}: {agent_name} (#{run_id})"
    body = f"Agent: {agent_name}\nRun ID: {run_id}\nStatus: {status}\n"
    if error:
        body += f"Error: {error}\n"
    send_email(subject, body)
