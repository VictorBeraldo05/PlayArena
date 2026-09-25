import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker


@pytest.mark.integration
def test_postgres_allows_only_one_concurrent_active_hold() -> None:
    """Exercise the real hold exclusion constraint against an isolated test DB."""
    required = (
        "PLAYARENA_TEST_DATABASE_URL",
        "PLAYARENA_TEST_COURT_ID",
        "PLAYARENA_TEST_PLAYER_ID",
        "PLAYARENA_TEST_SLOT_START_AT",
    )
    if any(not os.getenv(name) for name in required):
        pytest.skip("Set PLAYARENA_TEST_* variables for PostgreSQL concurrency coverage.")

    engine = create_engine(os.environ["PLAYARENA_TEST_DATABASE_URL"], pool_pre_ping=True)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    start_at = datetime.fromisoformat(os.environ["PLAYARENA_TEST_SLOT_START_AT"])
    end_at = start_at + timedelta(hours=1)
    created_ids: list[str] = []

    def attempt(number: int) -> str:
        try:
            with factory.begin() as session:
                arena_id = session.execute(
                    text("select arena_id from public.courts where id=:court_id"),
                    {"court_id": os.environ["PLAYARENA_TEST_COURT_ID"]},
                ).scalar_one()
                hold_id = session.execute(text("""
                    insert into public.booking_holds (
                      user_id, arena_id, court_id, customer_name, customer_phone,
                      start_at, end_at, court_price_total, booking_amount,
                      amount_due_at_venue, idempotency_key, expires_at
                    ) values (
                      :user_id, :arena_id, :court_id, 'Concurrency test', '00000000000',
                      :start_at, :end_at, 115, 5, 110, :idempotency_key,
                      timezone('utc', now()) + interval '10 minutes'
                    ) returning id
                """), {
                    "user_id": os.environ["PLAYARENA_TEST_PLAYER_ID"],
                    "arena_id": arena_id,
                    "court_id": os.environ["PLAYARENA_TEST_COURT_ID"],
                    "start_at": start_at,
                    "end_at": end_at,
                    "idempotency_key": f"integration-hold-{number}-{start_at.isoformat()}",
                }).scalar_one()
                created_ids.append(str(hold_id))
            return "success"
        except IntegrityError:
            return "conflict"

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(attempt, range(2)))
        assert sorted(results) == ["conflict", "success"]
    finally:
        if created_ids:
            with engine.begin() as session:
                session.execute(text("delete from public.booking_holds where id = any(:ids)"), {"ids": created_ids})
        engine.dispose()
