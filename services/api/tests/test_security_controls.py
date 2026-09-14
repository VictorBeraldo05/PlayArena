from datetime import datetime, timedelta

import pytest
from pydantic import ValidationError

from app.api.routes import owner as owner_routes
from app.core.config import DEFAULT_WEB_ORIGINS, settings
from app.core.rate_limit import InMemoryRateLimiter
from app.schemas.analytics import AnalyticsEventCreate
from app.schemas.booking import PlayerReservationCreate


def test_api_sets_private_response_security_headers(create_client) -> None:
    response = create_client.get("/health")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cache-control"] == "no-store"
    assert {"Authorization", "Origin"}.issubset(set(response.headers["vary"].replace(" ", "").split(",")))


@pytest.mark.parametrize("origin", DEFAULT_WEB_ORIGINS)
def test_cors_accepts_each_configured_origin_for_sports_preflight(create_client, origin: str) -> None:
    allowed = create_client.options(
        "/sports",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == origin
    assert "GET" in allowed.headers["access-control-allow-methods"]


def test_cors_allows_analytics_preflight_headers(create_client) -> None:
    response = create_client.options(
        "/analytics/events",
        headers={
            "Origin": "https://playarena-phi.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization, content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://playarena-phi.vercel.app"
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "content-type" in allowed_headers


def test_cors_decorates_allowed_sports_response(create_client, monkeypatch) -> None:
    monkeypatch.setattr(
        owner_routes.owner_repository,
        "list_sports",
        lambda: [{"id": 1, "name": "Society", "slug": "society"}],
    )
    response = create_client.get("/sports", headers={"Origin": "https://useplayarena.com.br"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://useplayarena.com.br"


def test_cors_decorates_early_error_response(create_client) -> None:
    response = create_client.post(
        "/analytics/events",
        content=b"{}",
        headers={
            "Origin": "https://www.useplayarena.com.br",
            "Content-Type": "application/json",
            "Content-Length": str(settings.max_request_body_bytes + 1),
        },
    )

    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "https://www.useplayarena.com.br"


def test_cors_rejects_unconfigured_origin(create_client) -> None:
    rejected = create_client.options(
        "/sports",
        headers={"Origin": "https://attacker.example", "Access-Control-Request-Method": "GET"},
    )

    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_rate_limiter_rejects_request_after_window_limit() -> None:
    limiter = InMemoryRateLimiter()

    assert limiter.allow("analytics:ip:127.0.0.1", limit=2, window_seconds=60)
    assert limiter.allow("analytics:ip:127.0.0.1", limit=2, window_seconds=60)
    assert not limiter.allow("analytics:ip:127.0.0.1", limit=2, window_seconds=60)


def test_analytics_rejects_pii_and_unknown_properties() -> None:
    payload = {"event_name": "app_opened", "session_id": "12345678", "properties": {"email": "player@example.com"}}
    with pytest.raises(ValidationError):
        AnalyticsEventCreate(**payload)

    payload["properties"] = {"unexpected": "value"}
    with pytest.raises(ValidationError):
        AnalyticsEventCreate(**payload)


def test_player_reservation_rejects_past_start_time() -> None:
    with pytest.raises(ValidationError):
        PlayerReservationCreate(
            court_id="20000000-0000-0000-0000-000000000001",
            start_at=datetime.now() - timedelta(minutes=1),
            customer_name="Jose",
            customer_phone="11999999999",
        )
