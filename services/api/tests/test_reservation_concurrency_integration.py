import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.repositories import booking_repository
from app.repositories.booking_repository import BookingConflictError


@pytest.mark.integration
def test_postgres_allows_only_one_concurrent_active_reservation(monkeypatch) -> None:
    """Exercise the real exclusion constraint, never a mocked conflict check.

    The explicit TEST variables protect normal/local Supabase databases from this
    destructive test. The configured slot must have an active court, opening hour
    and matching pricing rule.
    """
    required = ("PLAYARENA_TEST_DATABASE_URL", "PLAYARENA_TEST_COURT_ID", "PLAYARENA_TEST_PLAYER_ID", "PLAYARENA_TEST_SLOT_START_AT")
    if any(not os.getenv(name) for name in required):
        pytest.skip("Set PLAYARENA_TEST_* variables for PostgreSQL concurrency coverage.")

    engine = create_engine(os.environ["PLAYARENA_TEST_DATABASE_URL"], pool_pre_ping=True)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: factory)
    payload = {
        "court_id": os.environ["PLAYARENA_TEST_COURT_ID"],
        "start_at": datetime.fromisoformat(os.environ["PLAYARENA_TEST_SLOT_START_AT"]),
        "customer_name": "Concurrency test",
        "customer_phone": "00000000000",
    }
    created_ids: list[str] = []

    def attempt() -> str:
        try:
            reservation = booking_repository.create_player_reservation(os.environ["PLAYARENA_TEST_PLAYER_ID"], payload)
            created_ids.append(str(reservation["id"]))
            return "success"
        except BookingConflictError:
            return "conflict"

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _number: attempt(), range(2)))
        assert sorted(results) == ["conflict", "success"]
    finally:
        if created_ids:
            with engine.begin() as session:
                session.execute(text("delete from public.reservations where id = any(:ids)"), {"ids": created_ids})
        engine.dispose()
