from __future__ import annotations

from sqlalchemy import text

from app.db.session import get_session_factory

def get_profile_role(user_id: str) -> str | None:
    session_factory = get_session_factory()

    with session_factory() as session:
        result = session.execute(
            text("select role from public.profiles where id = :user_id"),
            {"user_id": user_id},
        ).scalar_one_or_none()

    if result is None:
        return None

    return result
