import inspect
from datetime import date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.api.routes import booking
from app.main import app
from app.repositories import booking_repository
from app.repositories.booking_repository import BookingConflictError
from app.schemas.auth import AuthenticatedUser
from app.schemas.booking import SAO_PAULO_TIME_ZONE, PlayerReservationCreate

PLAYER_A = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000a", email="a@playarena.dev")
OWNER_A = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000b", email="owner@playarena.dev")
COURT_A = "20000000-0000-0000-0000-000000000001"
FUTURE_START = (datetime.now() + timedelta(days=2)).replace(microsecond=0)


def route_request() -> Request:
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("127.0.0.1", 12345)})


def reservation_request() -> PlayerReservationCreate:
    return PlayerReservationCreate(court_id=COURT_A, start_at=FUTURE_START, customer_name="Jose", customer_phone="11999999999")


def test_availability_returns_server_resolved_option(monkeypatch) -> None:
    option = {"arena_id": "10000000-0000-0000-0000-000000000001", "arena_name": "Boleiros", "court_id": COURT_A, "court_name": "Campo 1", "start_at": FUTURE_START, "end_at": FUTURE_START + timedelta(hours=1), "duration_minutes": 60, "price": "150.00"}
    monkeypatch.setattr(booking, "available", lambda city, sport, start_at: [option])
    assert booking.get_availability(route_request(), "Piracicaba", "Society", FUTURE_START) == [option]


def test_availability_endpoint_matches_public_response_model(monkeypatch) -> None:
    option = {"arena_id": "10000000-0000-0000-0000-000000000001", "arena_name": "Boleiros", "court_id": COURT_A, "court_name": "Campo 1", "start_at": FUTURE_START.isoformat(), "end_at": (FUTURE_START + timedelta(hours=1)).isoformat(), "duration_minutes": 60, "price": "1.20"}
    monkeypatch.setattr(booking, "available", lambda city, sport, start_at: [option])
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.get(f"/availability?city=Piracicaba&sport=Society&start_at={FUTURE_START.isoformat()}")
    assert response.status_code == 200
    assert response.json()[0] == option


def test_availability_endpoint_forwards_optional_arena_and_court_filters(monkeypatch) -> None:
    arena_id = "10000000-0000-0000-0000-000000000001"
    captured = {}

    def scoped_available(city, sport, start_at, *, arena_id=None, court_id=None):
        captured.update(city=city, sport=sport, start_at=start_at, arena_id=arena_id, court_id=court_id)
        return []

    monkeypatch.setattr(booking, "available", scoped_available)
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.get(f"/availability?sport=Society&start_at={FUTURE_START.isoformat()}&arena_id={arena_id}&court_id={COURT_A}")

    assert response.status_code == 200
    assert captured["city"] is None
    assert captured["sport"] == "Society"
    assert str(captured["arena_id"]) == arena_id
    assert str(captured["court_id"]) == COURT_A


def test_public_availability_has_the_same_response_for_guest_and_authenticated_player(monkeypatch) -> None:
    option = {"arena_id": "10000000-0000-0000-0000-000000000001", "arena_name": "Boleiros", "court_id": COURT_A, "court_name": "Campo 1", "start_at": FUTURE_START.isoformat(), "end_at": (FUTURE_START + timedelta(hours=1)).isoformat(), "duration_minutes": 60, "price": "115.00"}
    monkeypatch.setattr(booking, "available", lambda city, sport, start_at: [option])

    with TestClient(app, raise_server_exceptions=True) as client:
        guest = client.get(f"/availability?city=Piracicaba&sport=Society&start_at={FUTURE_START.isoformat()}")
        player = client.get(
            f"/availability?city=Piracicaba&sport=Society&start_at={FUTURE_START.isoformat()}",
            headers={"Authorization": "Bearer ignored-by-public-discovery"},
        )

    assert guest.status_code == 200
    assert player.status_code == 200
    assert player.json() == guest.json() == [option]


def test_public_catalog_endpoint_returns_boleiros(monkeypatch) -> None:
    catalog = [{"id": "10000000-0000-0000-0000-000000000001", "name": "Boleiros", "city": "Piracicaba", "description": None, "court_count": 1, "sports": ["Society"], "price_from": "1.20"}]
    monkeypatch.setattr(booking, "public_arenas", lambda city: catalog)
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.get("/arenas?city=Piracicaba")
    assert response.status_code == 200
    assert response.json() == catalog


def public_schedule_payload(arena_id: str, court_id: str, day: date) -> dict:
    start_at = datetime.combine(day, datetime.min.time()).replace(hour=19)
    return {
        "arena_id": arena_id,
        "day": day,
        "is_open": True,
        "courts": [{"id": court_id, "name": "Campo 1", "default_duration_minutes": 60, "sports": ["Society"]}],
        "slots": [
            {"court_id": court_id, "start_at": start_at, "end_at": start_at + timedelta(minutes=60), "duration_minutes": 60, "status": "available", "price": "115.00"},
            {"court_id": court_id, "start_at": start_at + timedelta(hours=1), "end_at": start_at + timedelta(hours=2), "duration_minutes": 60, "status": "reserved", "price": None},
            {"court_id": court_id, "start_at": start_at + timedelta(hours=2), "end_at": start_at + timedelta(hours=3), "duration_minutes": 60, "status": "blocked", "price": None},
        ],
    }


def test_public_schedule_endpoint_returns_only_operational_slot_data(monkeypatch) -> None:
    arena_id = "10000000-0000-0000-0000-000000000001"
    day = FUTURE_START.date()
    captured = {}

    def schedule_for_arena(received_arena_id, received_day, court_id=None):
        captured.update(arena_id=received_arena_id, day=received_day, court_id=court_id)
        return public_schedule_payload(arena_id, COURT_A, day)

    monkeypatch.setattr(booking, "public_arena_schedule", schedule_for_arena)
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.get(f"/arenas/{arena_id}/schedule?day={day.isoformat()}&court_id={COURT_A}")

    assert response.status_code == 200
    assert str(captured["arena_id"]) == arena_id
    assert captured["day"] == day
    assert str(captured["court_id"]) == COURT_A
    first_slot = response.json()["slots"][0]
    assert first_slot == {
        "court_id": COURT_A,
        "start_at": f"{day.isoformat()}T19:00:00",
        "end_at": f"{day.isoformat()}T20:00:00",
        "duration_minutes": 60,
        "status": "available",
        "price": "115.00",
    }
    assert not {"customer_name", "customer_phone", "user_id", "reservation_id", "blocked_reason"}.intersection(first_slot)


def test_public_schedule_returns_404_for_unknown_arena_or_court(monkeypatch) -> None:
    arena_id = "10000000-0000-0000-0000-000000000001"
    day = FUTURE_START.date().isoformat()
    monkeypatch.setattr(booking, "public_arena_schedule", lambda *_args: None)
    with TestClient(app, raise_server_exceptions=True) as client:
        assert client.get(f"/arenas/{arena_id}/schedule?day={day}").status_code == 404

    monkeypatch.setattr(booking, "public_arena_schedule", lambda *_args: (_ for _ in ()).throw(booking.PublicScheduleCourtNotFoundError()))
    with TestClient(app, raise_server_exceptions=True) as client:
        assert client.get(f"/arenas/{arena_id}/schedule?day={day}&court_id={COURT_A}").status_code == 404


def test_public_schedule_rejects_past_days(create_client) -> None:
    past_day = datetime.now(SAO_PAULO_TIME_ZONE).date() - timedelta(days=1)
    response = create_client.get(f"/arenas/10000000-0000-0000-0000-000000000001/schedule?day={past_day.isoformat()}")
    assert response.status_code == 422


def test_public_schedule_repository_query_uses_public_operational_fields_only() -> None:
    query_source = inspect.getsource(booking_repository.public_arena_schedule).lower()
    assert "generate_series" in query_source
    assert "pricing_rules" in query_source
    assert "blocked_slots" in query_source
    assert "reservations r" in query_source
    assert "customer_name" not in query_source
    assert "customer_phone" not in query_source
    assert "user_id" not in query_source


def test_public_catalog_types_optional_city_for_postgresql(monkeypatch) -> None:
    class CatalogSession:
        def __init__(self) -> None:
            self.sql = ""
            self.params = {}

        def execute(self, statement, params):
            self.sql = str(statement)
            self.params = params
            return MappingRows([])

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    session = CatalogSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: lambda: session)

    assert booking_repository.public_arenas("Piracicaba") == []
    assert session.params == {"city": "Piracicaba"}
    assert "cast(:city as text) is null" in session.sql.lower()
    assert "a.logo_path" in session.sql.lower()


def test_player_reservation_contract_rejects_client_controlled_fields() -> None:
    assert set(reservation_request().model_dump()) == {"court_id", "start_at", "customer_name", "customer_phone"}
    with pytest.raises(ValueError):
        PlayerReservationCreate(court_id=COURT_A, start_at=FUTURE_START, customer_name="Jose", customer_phone="11999999999", price=1)


def test_player_reservation_conflict_is_controlled(monkeypatch) -> None:
    monkeypatch.setattr(booking, "create_player_reservation", lambda user_id, data: (_ for _ in ()).throw(BookingConflictError()))
    with pytest.raises(HTTPException) as error:
        booking.post_player_reservation(route_request(), reservation_request(), PLAYER_A)
    assert error.value.status_code == 409


def test_only_player_role_can_create_or_list_reservations() -> None:
    with pytest.raises(HTTPException) as error:
        booking.require_player(OWNER_A, "arena_owner")
    assert error.value.status_code == 403
    assert booking.require_player(PLAYER_A, "player") == PLAYER_A


def test_player_reservation_uses_authenticated_user_only(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(booking, "create_player_reservation", lambda user_id, data: captured.update(user_id=user_id, data=data) or {"id": "r"})
    booking.post_player_reservation(route_request(), reservation_request(), PLAYER_A)
    assert captured["user_id"] == PLAYER_A.id
    assert not {"arena_id", "end_at", "price", "status", "source"}.intersection(captured["data"])


def test_availability_rejects_past_start_time(create_client) -> None:
    response = create_client.get("/availability?city=Piracicaba&sport=Society&start_at=2020-01-01T20:00:00")
    assert response.status_code == 422


def test_player_reservations_are_loaded_for_authenticated_player_only(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(booking, "list_player_reservations", lambda user_id: captured.update(user_id=user_id) or [])
    booking.get_player_reservations(PLAYER_A)
    assert captured["user_id"] == PLAYER_A.id


def test_player_reservation_history_keeps_same_reservation_after_owner_confirmation(monkeypatch) -> None:
    reservations = [{"id": "reservation-id", "status": "pending", "start_at": "2026-09-02T20:00:00Z", "end_at": "2026-09-02T21:00:00Z"}]
    monkeypatch.setattr(booking, "list_player_reservations", lambda user_id: reservations if user_id == PLAYER_A.id else [])

    pending = booking.get_player_reservations(PLAYER_A)
    pending_status = pending[0]["status"]
    reservations[0]["status"] = "confirmed"
    confirmed = booking.get_player_reservations(PLAYER_A)

    assert pending[0]["id"] == confirmed[0]["id"]
    assert pending_status == "pending"
    assert confirmed[0]["status"] == "confirmed"


@pytest.mark.parametrize("reservation_status", ["pending", "confirmed", "cancelled", "completed", "no_show"])
def test_player_reservation_history_returns_every_supported_status(monkeypatch, reservation_status: str) -> None:
    reservation = {"id": "reservation-id", "status": reservation_status, "start_at": "2026-09-02T20:00:00Z", "end_at": "2026-09-02T21:00:00Z"}
    monkeypatch.setattr(booking, "list_player_reservations", lambda _user_id: [reservation])

    assert booking.get_player_reservations(PLAYER_A) == [reservation]


class MappingRows:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def __iter__(self):
        return iter(self.rows)


class AvailabilitySession:
    def __init__(self):
        self.sql = ""
        self.params = {}

    def execute(self, statement, params):
        self.sql = str(statement)
        self.params = params
        return MappingRows([
            {"court_id": UUID(COURT_A), "price": 150, "duration_minutes": 60},
            {"court_id": UUID("20000000-0000-0000-0000-000000000002"), "price": None, "duration_minutes": 60},
        ])

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class PlayerReservationsSession:
    def __init__(self):
        self.sql = ""
        self.params = {}

    def execute(self, statement, params):
        self.sql = str(statement)
        self.params = params
        return MappingRows([
            {"id": "pending-id", "status": "pending"},
            {"id": "confirmed-id", "status": "confirmed"},
            {"id": "cancelled-id", "status": "cancelled"},
            {"id": "completed-id", "status": "completed"},
            {"id": "no-show-id", "status": "no_show"},
        ])

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def test_player_reservation_repository_filters_only_by_authenticated_user(monkeypatch) -> None:
    session = PlayerReservationsSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: lambda: session)

    reservations = booking_repository.list_player_reservations(PLAYER_A.id)

    assert session.params == {"user_id": PLAYER_A.id}
    assert "where r.user_id = :user_id" in session.sql.lower()
    assert "status in" not in session.sql.lower()
    assert [reservation["status"] for reservation in reservations] == ["pending", "confirmed", "cancelled", "completed", "no_show"]


@pytest.mark.parametrize("expected_sql", [
    "a.active and c.active",
    "lower(s.name) = lower(:sport)",
    "oh.open_time <= ca.start_at::time and oh.close_time >= ca.end_at::time",
    "tstzrange(b.start_at, b.end_at, '[)') && tstzrange(ca.start_at, ca.end_at, '[)')",
    "r.status in ('pending', 'confirmed')",
    "r.reservation_window && tstzrange(ca.start_at, ca.end_at, '[)')",
    "(pr.end_time - pr.start_time) asc, pr.created_at desc, pr.id desc",
])
def test_availability_query_enforces_full_slot_rules(monkeypatch, expected_sql: str) -> None:
    session = AvailabilitySession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: lambda: session)
    options = booking_repository.available("Piracicaba", "Society", datetime(2026, 9, 4, 20))
    assert len(options) == 1
    assert options[0]["duration_minutes"] == 60
    assert expected_sql in session.sql


def test_availability_keeps_the_next_slot_available_after_a_player_reservation(monkeypatch) -> None:
    """The database query receives the newly selected slot, never reservation state."""

    class ReservationAwareAvailabilitySession:
        def __init__(self) -> None:
            self.calls = []

        def execute(self, statement, params):
            self.calls.append((str(statement), params))
            selected_hour = params["start_at"].hour
            if selected_hour == 19:
                # Campo 1 has a pending reservation from 19:00 to 20:00.
                return MappingRows([{"court_id": UUID("20000000-0000-0000-0000-000000000002"), "price": 115, "duration_minutes": 60}])
            return MappingRows([
                {"court_id": UUID(COURT_A), "price": 115, "duration_minutes": 60},
                {"court_id": UUID("20000000-0000-0000-0000-000000000002"), "price": 115, "duration_minutes": 60},
            ])

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    session = ReservationAwareAvailabilitySession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: lambda: session)

    occupied_slot = booking_repository.available("Piracicaba", "Society", datetime(2026, 9, 8, 19))
    following_slot = booking_repository.available("Piracicaba", "Society", datetime(2026, 9, 8, 20))

    assert [str(option["court_id"]) for option in occupied_slot] == ["20000000-0000-0000-0000-000000000002"]
    assert {str(option["court_id"]) for option in following_slot} == {COURT_A, "20000000-0000-0000-0000-000000000002"}
    assert [call[1]["start_at"] for call in session.calls] == [datetime(2026, 9, 8, 19), datetime(2026, 9, 8, 20)]
    assert "reservation_window && tstzrange(ca.start_at, ca.end_at, '[)')" in session.calls[-1][0]
