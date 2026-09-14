import asyncio
import inspect
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

from app.api.routes import booking
from app.repositories import booking_repository
from app.repositories.booking_repository import (
    PlayerCancellationWindowClosedError,
    PlayerReservationNotFoundError,
    PlayerReservationStateError,
)
from app.schemas.auth import AuthenticatedUser
from app.schemas.booking import SAO_PAULO_TIME_ZONE

PLAYER_A = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000a", email="player-a@playarena.dev")
PLAYER_B = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000b", email="player-b@playarena.dev")
RESERVATION_ID = UUID("50000000-0000-0000-0000-000000000001")
START_AT = datetime(2026, 9, 20, 20, 0, tzinfo=SAO_PAULO_TIME_ZONE)


def route_request() -> Request:
    return Request({"type": "http", "method": "PATCH", "path": "/", "headers": [], "client": ("127.0.0.1", 12345)})


class Result:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def one_or_none(self):
        return self.row


class CancellationSession:
    def __init__(self, status: str = "pending", owner_id: str = PLAYER_A.id):
        self.row = {"id": RESERVATION_ID, "status": status, "start_at": START_AT}
        self.owner_id = owner_id
        self.update_count = 0
        self.sql: list[str] = []
        self.payloads: list[dict] = []

    def execute(self, statement, params):
        sql = str(statement)
        self.sql.append(sql)
        self.payloads.append(params)
        if "select id, status, start_at" in sql:
            return Result(self.row.copy() if params["user_id"] == self.owner_id else None)
        if "update public.reservations" in sql:
            allowed = params["cancelled_at"] <= self.row["start_at"] - timedelta(minutes=90)
            current = self.row["status"] == params["current_status"]
            if not allowed or not current:
                return Result(None)
            self.update_count += 1
            self.row["status"] = "cancelled"
            self.row["cancelled_at"] = params["cancelled_at"]
            return Result({"id": RESERVATION_ID, "status": "cancelled", "cancelled_at": params["cancelled_at"]})
        raise AssertionError(sql)


class Transaction:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *_args):
        return False


class Factory:
    def __init__(self, session):
        self.session = session

    def begin(self):
        return Transaction(self.session)


def cancel_with(session: CancellationSession, now: datetime, user_id: str = PLAYER_A.id):
    return booking_repository.cancel_player_reservation(user_id, RESERVATION_ID, current_time=now)


def test_player_cancels_own_reservation_more_than_ninety_minutes_before_start(monkeypatch) -> None:
    session = CancellationSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))

    changed = cancel_with(session, START_AT - timedelta(hours=2))

    assert changed["status"] == "cancelled"
    assert changed["previous_status"] == "pending"
    assert session.row["status"] == "cancelled"
    assert session.update_count == 1


def test_player_cancellation_is_blocked_after_the_ninety_minute_deadline(monkeypatch) -> None:
    session = CancellationSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))

    with pytest.raises(PlayerCancellationWindowClosedError):
        cancel_with(session, START_AT - timedelta(minutes=89))

    assert session.row["status"] == "pending"
    assert session.update_count == 0


def test_player_cancellation_is_allowed_at_the_exact_ninety_minute_deadline(monkeypatch) -> None:
    session = CancellationSession(status="confirmed")
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))

    changed = cancel_with(session, START_AT - timedelta(minutes=90))

    assert changed["previous_status"] == "confirmed"
    assert changed["status"] == "cancelled"
    assert session.payloads[-1]["cancelled_at"] == START_AT - timedelta(minutes=90)


def test_player_cannot_cancel_another_players_reservation(monkeypatch) -> None:
    session = CancellationSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))

    with pytest.raises(PlayerReservationNotFoundError):
        cancel_with(session, START_AT - timedelta(hours=2), user_id=PLAYER_B.id)

    assert session.update_count == 0


@pytest.mark.parametrize("reservation_status", ["cancelled", "completed", "no_show"])
def test_player_cannot_cancel_a_non_cancellable_status(monkeypatch, reservation_status: str) -> None:
    session = CancellationSession(status=reservation_status)
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))

    with pytest.raises(PlayerReservationStateError):
        cancel_with(session, START_AT - timedelta(hours=2))

    assert session.update_count == 0


def test_repeated_player_cancellation_has_no_second_transition(monkeypatch) -> None:
    session = CancellationSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: Factory(session))

    cancel_with(session, START_AT - timedelta(hours=2))
    with pytest.raises(PlayerReservationStateError):
        cancel_with(session, START_AT - timedelta(hours=2))

    assert session.update_count == 1


def test_cancelled_reservations_stop_blocking_the_public_slot() -> None:
    availability_query = inspect.getsource(booking_repository.available)
    schedule_query = inspect.getsource(booking_repository.public_arena_schedule)

    assert "status in ('pending', 'confirmed')" in availability_query
    assert "status in ('pending', 'confirmed')" in schedule_query
    assert "status = 'cancelled'" in inspect.getsource(booking_repository.cancel_player_reservation)


def test_player_cancel_route_schedules_one_cancellation_email_after_a_real_transition(monkeypatch) -> None:
    sent: list[tuple] = []
    monkeypatch.setattr(booking, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(booking, "cancel_player_reservation", lambda *_args: {"id": RESERVATION_ID, "status": "cancelled", "previous_status": "pending"})
    monkeypatch.setattr(booking, "send_reservation_status_notification", lambda *args, **kwargs: sent.append((args, kwargs)))
    tasks = BackgroundTasks()

    response = booking.patch_player_reservation_cancel(route_request(), tasks, RESERVATION_ID, PLAYER_A)
    asyncio.run(tasks())

    assert response == {"id": RESERVATION_ID, "status": "cancelled"}
    assert sent == [((RESERVATION_ID, "pending", "cancelled"), {"cancellation_by_player": True})]


def test_player_cancel_route_returns_semantic_deadline_error_without_scheduling_email(monkeypatch) -> None:
    monkeypatch.setattr(booking, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(booking, "cancel_player_reservation", lambda *_args: (_ for _ in ()).throw(PlayerCancellationWindowClosedError()))
    tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as error:
        booking.patch_player_reservation_cancel(route_request(), tasks, RESERVATION_ID, PLAYER_A)

    assert error.value.status_code == 409
    assert error.value.detail == {"code": "cancellation_window_closed", "message": "Esta reserva não pode mais ser cancelada."}
    assert tasks.tasks == []
