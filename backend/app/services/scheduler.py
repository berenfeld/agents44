import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.extensions import db
from app.models import SystemAgent
from app.services.agent_runner import start_agent

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def _cron_job(agent_id: int) -> None:
    from app import get_app

    app = get_app()
    with app.app_context():
        start_agent(agent_id, "cron")


def sync_scheduler_jobs() -> None:
    if not scheduler.running:
        return
    scheduler.remove_all_jobs()
    agents = SystemAgent.query.filter(SystemAgent.enabled.is_(True), SystemAgent.crond.isnot(None)).all()
    for agent in agents:
        if not agent.crond:
            continue
        try:
            trigger = CronTrigger.from_crontab(agent.crond)
        except ValueError:
            logger.warning("Invalid cron for agent %s: %s", agent.name, agent.crond)
            continue
        scheduler.add_job(
            _cron_job,
            trigger=trigger,
            args=[agent.id],
            id=f"agent-{agent.id}",
            replace_existing=True,
            max_instances=1,
        )


def init_scheduler(app) -> None:
    if scheduler.running:
        return
    scheduler.start()
    with app.app_context():
        sync_scheduler_jobs()
    logger.info("APScheduler started")
