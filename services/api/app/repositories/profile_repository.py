from __future__ import annotations

import logging

from sqlalchemy import text

from app.db.session import get_session_factory

logger = logging.getLogger(__name__)


def get_profile_role(user_id: str) -> str | None:
    logger.info("[PROFILE] querying profile for user=%s", user_id)
    session_factory = get_session_factory()

    with session_factory() as session:
        result = session.execute(
            text("select role from public.profiles where id = :user_id"),
            {"user_id": user_id},
        ).scalar_one_or_none()

    if result is None:
        logger.info("[PROFILE] profile not found for user=%s", user_id)
        return None

    logger.info("[PROFILE] profile found for user=%s", user_id)
    return result
