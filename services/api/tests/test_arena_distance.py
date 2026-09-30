from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.api.routes import booking
from app.main import app
from app.repositories import booking_repository, owner_repository
from app.schemas.owner import ArenaUpdate
from app.services.arena_distance import distance_km
from app.services import arena_geocoding


def test_haversine_known_distance() -> None:
    assert distance_km(0, 0, 0, 1) == pytest.approx(111.195, abs=0.1)
    assert distance_km(-22.72, -47.64, -22.72, -47.64) == pytest.approx(0)


def test_distance_sort_keeps_unknown_arenas_last_and_preserves_court_groups() -> None:
    rows = [
        {"arena_id": "far", "court_id": "f1", "latitude": -22.8, "longitude": -47.64, "price": Decimal("120")},
        {"arena_id": "unknown", "court_id": "u1", "latitude": None, "longitude": None, "price": Decimal("90")},
        {"arena_id": "near", "court_id": "n1", "latitude": -22.721, "longitude": -47.64, "price": Decimal("130")},
        {"arena_id": "near", "court_id": "n2", "latitude": -22.721, "longitude": -47.64, "price": Decimal("115")},
    ]
    sorted_rows = booking_repository._sort_availability_by_arena(booking_repository._with_distances(rows, -22.72, -47.64), "distance")
    assert [row["arena_id"] for row in sorted_rows] == ["near", "near", "far", "unknown"]
    assert sorted_rows[0]["distance_km"] < sorted_rows[2]["distance_km"]
    assert "distance_km" not in sorted_rows[-1]
    assert all("latitude" not in row and "longitude" not in row for row in sorted_rows)


def test_price_sort_uses_lowest_real_slot_price_per_arena() -> None:
    rows = [
        {"arena_id": "a", "price": Decimal("180")},
        {"arena_id": "b", "price": Decimal("130")},
        {"arena_id": "a", "price": Decimal("115")},
    ]
    assert [row["arena_id"] for row in booking_repository._sort_availability_by_arena(rows, "price")] == ["a", "a", "b"]


@pytest.mark.parametrize("query", [
    "latitude=91&longitude=0&sort=distance",
    "latitude=0&longitude=-181&sort=distance",
    "latitude=0&sort=distance",
    "longitude=0&sort=distance",
    "sort=distance",
])
def test_catalog_rejects_invalid_or_incomplete_location(query: str) -> None:
    with TestClient(app) as client:
        assert client.get(f"/arenas?{query}").status_code == 422


def test_catalog_forwards_city_sport_and_valid_distance_sort(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(booking, "public_arenas", lambda city, **kwargs: captured.update(city=city, **kwargs) or [])
    with TestClient(app) as client:
        response = client.get("/arenas?city=Piracicaba&sport=Society&latitude=-22.72&longitude=-47.64&sort=distance")
    assert response.status_code == 200
    assert captured == {"city": "Piracicaba", "sport": "Society", "latitude": -22.72, "longitude": -47.64, "sort": "distance"}


def test_availability_forwards_distance_without_changing_city_filter(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(booking, "available", lambda city, sport, start_at, **kwargs: captured.update(city=city, sport=sport, **kwargs) or [])
    with TestClient(app) as client:
        from datetime import datetime, timedelta
        start = (datetime.now() + timedelta(days=2)).replace(microsecond=0).isoformat()
        response = client.get(f"/availability?city=Piracicaba&sport=Society&start_at={start}&latitude=-22.72&longitude=-47.64&sort=distance")
    assert response.status_code == 200
    assert captured["city"] == "Piracicaba"
    assert captured["sort"] == "distance"
    assert captured["latitude"] == -22.72
    assert captured["longitude"] == -47.64


def test_owner_coordinate_pair_validation() -> None:
    assert ArenaUpdate(latitude=-22.72, longitude=-47.64).latitude == -22.72
    with pytest.raises(ValueError):
        ArenaUpdate(latitude=-22.72)
    with pytest.raises(ValueError):
        ArenaUpdate(longitude=-47.64)
    with pytest.raises(ValueError):
        ArenaUpdate(latitude=91, longitude=0)
    with pytest.raises(ValueError):
        ArenaUpdate(latitude=0, longitude=-181)
    with pytest.raises(ValueError):
        ArenaUpdate(latitude=float("nan"), longitude=0)


def test_geocoder_accepts_matching_brazilian_result_only(monkeypatch) -> None:
    monkeypatch.setattr(arena_geocoding.settings, "arena_geocoding_url", "https://geo.example/search")

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [{"lat": "-22.72", "lon": "-47.64", "display_name": "Rua A, Piracicaba, São Paulo, Brasil", "address": {"country_code": "br", "ISO3166-2-lvl4": "BR-SP"}}]

    monkeypatch.setattr(arena_geocoding.httpx, "get", lambda *_args, **_kwargs: Response())
    assert arena_geocoding.geocode_arena_address("Rua A", "Piracicaba", "SP") == (-22.72, -47.64)
    assert arena_geocoding.geocode_arena_address("Rua A", "Campinas", "SP") is None
    assert arena_geocoding.geocode_arena_address("Rua A", "Piracicaba", "RJ") is None


def test_geocoder_ignores_malformed_or_unconfigured_results(monkeypatch) -> None:
    monkeypatch.setattr(arena_geocoding.settings, "arena_geocoding_url", None)
    assert arena_geocoding.geocode_arena_address("Rua A", "Piracicaba", "SP") is None
    monkeypatch.setattr(arena_geocoding.settings, "arena_geocoding_url", "https://geo.example/search")

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [{"lat": "-22.72", "lon": "-47.64", "address": None}]

    monkeypatch.setattr(arena_geocoding.httpx, "get", lambda *_args, **_kwargs: Response())
    assert arena_geocoding.geocode_arena_address("Rua A", "Piracicaba", "SP") is None


def test_owner_address_change_clears_stale_coordinates_when_geocoding_fails(monkeypatch) -> None:
    existing = {"address": "Rua Antiga", "city": "Piracicaba", "state": "SP", "latitude": Decimal("-22.72"), "longitude": Decimal("-47.64")}
    monkeypatch.setattr(owner_repository, "get_arena", lambda *_args: existing)
    monkeypatch.setattr(owner_repository, "_owned_arena", lambda *_args: existing)
    monkeypatch.setattr(owner_repository, "geocode_arena_address", lambda *_args: None)

    class Session:
        def __init__(self):
            self.params = None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, _statement, params):
            self.params = params

    session = Session()
    monkeypatch.setattr(owner_repository, "get_session_factory", lambda: type("Factory", (), {"begin": lambda self: session})())
    owner_repository.update_arena("owner", "arena", {"address": "Rua Nova"})
    assert session.params["latitude"] is None
    assert session.params["longitude"] is None
