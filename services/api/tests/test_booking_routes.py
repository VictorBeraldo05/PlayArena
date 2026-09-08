from datetime import datetime
from uuid import UUID

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.routes import booking
from app.main import app
from app.repositories import booking_repository
from app.repositories.booking_repository import BookingConflictError
from app.schemas.auth import AuthenticatedUser
from app.schemas.booking import PlayerReservationCreate

PLAYER_A = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000a", email="a@playarena.dev")
OWNER_A = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000b", email="owner@playarena.dev")
COURT_A = "20000000-0000-0000-0000-000000000001"


def reservation_request() -> PlayerReservationCreate:
    return PlayerReservationCreate(court_id=COURT_A, start_at="2026-09-04T20:00:00", customer_name="Jose", customer_phone="11999999999")


def test_availability_returns_server_resolved_option(monkeypatch) -> None:
    option = {"arena_id": "10000000-0000-0000-0000-000000000001", "arena_name": "Boleiros", "court_id": COURT_A, "court_name": "Campo 1", "start_at": datetime(2026, 9, 4, 20), "end_at": datetime(2026, 9, 4, 21), "duration_minutes": 60, "price": "150.00"}
    monkeypatch.setattr(booking, "available", lambda city, sport, start_at: [option])
    assert booking.get_availability("Piracicaba", "Society", datetime(2026, 9, 4, 20)) == [option]


def test_availability_endpoint_matches_public_response_model(monkeypatch) -> None:
    option = {"arena_id": "10000000-0000-0000-0000-000000000001", "arena_name": "Boleiros", "court_id": COURT_A, "court_name": "Campo 1", "start_at": "2026-09-02T20:00:00", "end_at": "2026-09-02T21:00:00", "duration_minutes": 60, "price": "1.20"}
    monkeypatch.setattr(booking, "available", lambda city, sport, start_at: [option])
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.get("/availability?city=Piracicaba&sport=Society&start_at=2026-09-02T20:00:00")
    assert response.status_code == 200
    assert response.json()[0] == option


def test_public_availability_has_the_same_response_for_guest_and_authenticated_player(monkeypatch) -> None:
    option = {"arena_id": "10000000-0000-0000-0000-000000000001", "arena_name": "Boleiros", "court_id": COURT_A, "court_name": "Campo 1", "start_at": "2026-09-08T20:00:00", "end_at": "2026-09-08T21:00:00", "duration_minutes": 60, "price": "115.00"}
    monkeypatch.setattr(booking, "available", lambda city, sport, start_at: [option])

    with TestClient(app, raise_server_exceptions=True) as client:
        guest = client.get("/availability?city=Piracicaba&sport=Society&start_at=2026-09-08T20:00:00")
        player = client.get(
            "/availability?city=Piracicaba&sport=Society&start_at=2026-09-08T20:00:00",
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


def test_player_reservation_conflict_is_controlled(monkeypatch) -> None:
    monkeypatch.setattr(booking, "create_player_reservation", lambda user_id, data: (_ for _ in ()).throw(BookingConflictError()))
    with pytest.raises(HTTPException) as error:
        booking.post_player_reservation(reservation_request(), PLAYER_A)
    assert error.value.status_code == 409


def test_only_player_role_can_create_or_list_reservations() -> None:
    with pytest.raises(HTTPException) as error:
        booking.require_player(OWNER_A, "arena_owner")
    assert error.value.status_code == 403
    assert booking.require_player(PLAYER_A, "player") == PLAYER_A


def test_player_reservation_uses_authenticated_user_only(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(booking, "create_player_reservation", lambda user_id, data: captured.update(user_id=user_id, data=data) or {"id": "r"})
    booking.post_player_reservation(reservation_request(), PLAYER_A)
    assert captured["user_id"] == PLAYER_A.id
    assert not {"arena_id", "end_at", "price", "status", "source"}.intersection(captured["data"])


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
