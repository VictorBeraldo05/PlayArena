from datetime import datetime
from decimal import Decimal

import pytest

from app.repositories import booking_repository


class Result:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def one_or_none(self):
        return self.row

    def one(self):
        return self.row

    def scalar_one_or_none(self):
        return self.row


class ReservationSession:
    def __init__(self, opening=True):
        self.opening = opening
        self.calls = []

    def execute(self, statement, params):
        sql = str(statement)
        self.calls.append((sql, params))
        if "select c.arena_id" in sql:
            return Result({"arena_id": "10000000-0000-0000-0000-000000000001", "default_duration_minutes": 60})
        if "from public.opening_hours" in sql:
            return Result(1 if self.opening else None)
        if "from public.blocked_slots" in sql or "from public.reservations where" in sql:
            return Result(None)
        if "select pr.price" in sql:
            return Result(Decimal("1.20"))
        if "insert into public.reservations" in sql:
            return Result({"id": "reservation-id", **params, "status": "pending", "source": "app"})
        raise AssertionError(sql)


class Factory:
    def __init__(self, session):
        self.session = session

    def begin(self):
        return self

    def __enter__(self):
        return self.session

    def __exit__(self, *_args):
        return False


def test_player_reservation_derives_end_at_and_uses_safe_time_casts(monkeypatch) -> None:
    session = ReservationSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))
    reservation = booking_repository.create_player_reservation("player-id", {"court_id": "court-id", "start_at": datetime(2026, 9, 2, 20), "customer_name": "José", "customer_phone": "19989876565"})
    opening_sql, opening_payload = next(call for call in session.calls if "from public.opening_hours" in call[0])
    assert opening_payload["end_at"] == datetime(2026, 9, 2, 21)
    assert "CAST(:start_at AS time)" in opening_sql
    assert ":start_at::time" not in opening_sql
    assert reservation["status"] == "pending"
    assert reservation["source"] == "app"


def test_player_reservation_rejects_slot_outside_opening_hours(monkeypatch) -> None:
    session = ReservationSession(opening=False)
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))
    with pytest.raises(ValueError, match="Court is closed"):
        booking_repository.create_player_reservation("player-id", {"court_id": "court-id", "start_at": datetime(2026, 9, 2, 22, 30), "customer_name": "José", "customer_phone": "19989876565"})
    opening_payload = next(params for sql, params in session.calls if "from public.opening_hours" in sql)
    assert opening_payload["end_at"] == datetime(2026, 9, 2, 23, 30)
