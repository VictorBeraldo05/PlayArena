import hashlib
import hmac
import json
from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.routes import payments as payment_routes
from app.core.config import Settings
from app.services.payments.mercado_pago import MercadoPagoProvider
from app.services.payments.providers import PaymentProviderError

PAYMENT_ID = "60000000-0000-0000-0000-000000000001"
ORDER_ID = "ORDTST01PLAYARENA00000000000001"
WEBHOOK_SECRET = "webhook-test-secret"
RETURN_URL = "https://useplayarena.com.br/pagamento/retorno"


def order_payload(
    *,
    status: str = "created",
    status_detail: str = "created",
    amount: str = "5.00",
    currency: str = "BRL",
    external_reference: str = PAYMENT_ID,
) -> dict:
    return {
        "id": ORDER_ID,
        "status": status,
        "status_detail": status_detail,
        "total_amount": amount,
        "currency": currency,
        "external_reference": external_reference,
        "checkout_url": f"https://www.mercadopago.com.br/checkout/v1/redirect?order_id={ORDER_ID}",
        "live_mode": False,
    }


def provider(handler) -> MercadoPagoProvider:
    return MercadoPagoProvider(
        access_token="APP_USR_TEST_ONLY",
        webhook_secret=WEBHOOK_SECRET,
        return_url=RETURN_URL,
        transport=httpx.MockTransport(handler),
        sleeper=lambda _seconds: None,
    )


def signed_webhook(*, live_mode: bool = False, signature_override: str | None = None):
    request_id = "request-123"
    timestamp = "1760000000000"
    body = json.dumps(
        {
            "id": "notification-123",
            "type": "order",
            "action": "order.processed",
            "live_mode": live_mode,
            "data": {"id": ORDER_ID},
        },
        separators=(",", ":"),
    ).encode()
    manifest = f"id:{ORDER_ID};request-id:{request_id};ts:{timestamp};"
    digest = hmac.new(WEBHOOK_SECRET.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return body, signature_override or f"ts={timestamp},v1={digest}", request_id


def test_create_order_uses_backend_values_idempotency_and_hosted_checkout() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json=order_payload())

    result = provider(handler).create_payment(
        payment_id=PAYMENT_ID,
        amount=Decimal("5.00"),
        currency="BRL",
        expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
        idempotency_key="checkout_1234567890abcdef",
        payer_email="buyer@testuser.com",
    )

    request = captured["request"]
    body = captured["body"]
    assert request.method == "POST"
    assert request.url.path == "/v1/orders"
    assert request.headers["x-idempotency-key"] == "checkout_1234567890abcdef"
    assert request.headers["authorization"] == "Bearer APP_USR_TEST_ONLY"
    assert body["total_amount"] == "5.00"
    assert body["items"] == [
        {
            "title": "Reserva PlayArena",
            "quantity": 1,
            "unit_measure": "unit",
            "unit_price": "5.00",
            "total_amount": "5.00",
        }
    ]
    assert body["external_reference"] == PAYMENT_ID
    assert body["payer"] == {"email": "buyer@testuser.com"}
    assert body["config"]["online"]["success_url"].startswith(
        f"{RETURN_URL}?payment_id={PAYMENT_ID}"
    )
    assert result.provider_payment_id == ORDER_ID
    assert result.checkout_url and result.checkout_url.startswith("https://www.mercadopago.com.br/")


def test_get_order_uses_authenticated_orders_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == f"/v1/orders/{ORDER_ID}"
        return httpx.Response(
            200,
            json=order_payload(status="processed", status_detail="accredited"),
        )

    state = provider(handler).get_payment(ORDER_ID)

    assert state.status == "paid"
    assert state.amount == Decimal("5.00")
    assert state.currency == "BRL"
    assert state.external_reference == PAYMENT_ID


@pytest.mark.parametrize(
    ("provider_status", "status_detail", "expected"),
    [
        ("created", "created", "pending"),
        ("processing", "in_process", "pending"),
        ("failed", "high_risk", "failed"),
        ("canceled", "canceled", "cancelled"),
        ("expired", "expired", "cancelled"),
        ("processed", "accredited", "paid"),
        ("processed", "refunded", "cancelled"),
    ],
)
def test_order_status_mapping(provider_status: str, status_detail: str, expected: str) -> None:
    transport = lambda _request: httpx.Response(  # noqa: E731
        200,
        json=order_payload(status=provider_status, status_detail=status_detail),
    )

    assert provider(transport).get_payment(ORDER_ID).status == expected


def test_valid_webhook_uses_official_signature_then_fetches_order() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(
            200,
            json=order_payload(status="processed", status_detail="accredited"),
        )

    body, signature, request_id = signed_webhook()
    event = provider(handler).verify_webhook(
        body,
        signature,
        request_id=request_id,
        data_id=ORDER_ID,
        topic="order",
    )

    assert calls == [f"/v1/orders/{ORDER_ID}"]
    assert event.event_id == "notification-123"
    assert event.status == "paid"
    assert event.external_reference == PAYMENT_ID


def test_invalid_webhook_signature_is_rejected_before_get_order() -> None:
    body, _, request_id = signed_webhook(signature_override="ts=1760000000000,v1=" + "0" * 64)

    with pytest.raises(PaymentProviderError, match="signature"):
        provider(lambda _request: pytest.fail("GET must not run")).verify_webhook(
            body,
            "ts=1760000000000,v1=" + "0" * 64,
            request_id=request_id,
            data_id=ORDER_ID,
            topic="order",
        )


def test_production_webhook_is_explicitly_blocked() -> None:
    body, signature, request_id = signed_webhook(live_mode=True)

    with pytest.raises(PaymentProviderError) as error:
        provider(lambda _request: pytest.fail("GET must not run")).verify_webhook(
            body,
            signature,
            request_id=request_id,
            data_id=ORDER_ID,
            topic="order",
        )

    assert error.value.code == "production_payment_blocked"


def test_create_order_rejects_non_test_order_before_redirect() -> None:
    payload = order_payload()
    payload.update(
        id="ORD01PRODUCTION",
        checkout_url="https://www.mercadopago.com.br/checkout/v1/redirect?order_id=ORD01PRODUCTION",
    )

    with pytest.raises(PaymentProviderError) as error:
        provider(lambda _request: httpx.Response(201, json=payload)).create_payment(
            payment_id=PAYMENT_ID,
            amount=Decimal("5.00"),
            currency="BRL",
            expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
            idempotency_key="checkout_1234567890abcdef",
        )

    assert error.value.code == "production_payment_blocked"
    assert error.value.indeterminate


def test_public_webhook_route_forwards_official_metadata(
    create_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    def fake_process_webhook(provider_name, payload, signature, **metadata):
        captured.update(
            provider_name=provider_name,
            payload=payload,
            signature=signature,
            metadata=metadata,
        )
        return {"result": "processed"}

    monkeypatch.setattr(payment_routes, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(payment_routes, "process_webhook", fake_process_webhook)

    response = create_client.post(
        f"/payments/webhooks/mercado-pago?data.id={ORDER_ID}&type=order",
        headers={"x-signature": "ts=1,v1=signature", "x-request-id": "request-123"},
        content=b'{"type":"order"}',
    )

    assert response.status_code == 200
    assert response.json() == {"result": "processed"}
    assert captured == {
        "provider_name": "mercado_pago",
        "payload": b'{"type":"order"}',
        "signature": "ts=1,v1=signature",
        "metadata": {
            "request_id": "request-123",
            "data_id": ORDER_ID,
            "topic": "order",
        },
    }


def test_create_order_timeout_retries_once_with_the_same_idempotency_key() -> None:
    keys = []

    def handler(request: httpx.Request) -> httpx.Response:
        keys.append(request.headers["x-idempotency-key"])
        raise httpx.ReadTimeout("timeout", request=request)

    with pytest.raises(PaymentProviderError) as error:
        provider(handler).create_payment(
            payment_id=PAYMENT_ID,
            amount=Decimal("5.00"),
            currency="BRL",
            expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
            idempotency_key="checkout_1234567890abcdef",
        )

    assert keys == ["checkout_1234567890abcdef"] * 2
    assert error.value.retryable
    assert error.value.indeterminate
    assert error.value.code == "provider_timeout"


@pytest.mark.parametrize("status_code", [429, 500])
def test_transient_create_order_response_retries_once(status_code: int) -> None:
    attempts = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(status_code, json={"error": "not logged"})

    with pytest.raises(PaymentProviderError) as error:
        provider(handler).create_payment(
            payment_id=PAYMENT_ID,
            amount=Decimal("5.00"),
            currency="BRL",
            expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
            idempotency_key="checkout_1234567890abcdef",
        )

    assert attempts == 2
    assert error.value.retryable
    assert error.value.indeterminate


def test_mercado_pago_config_rejects_production_and_contradictory_flags() -> None:
    common = {
        "_env_file": None,
        "PAYMENT_PROVIDER": "mercado_pago",
        "PAYMENT_SANDBOX_ENABLED": True,
        "MERCADO_PAGO_ACCESS_TOKEN": "APP_USR_TEST_ONLY",
        "MERCADO_PAGO_WEBHOOK_SECRET": WEBHOOK_SECRET,
        "FRONTEND_URL": "https://useplayarena.com.br",
    }
    with pytest.raises(ValidationError, match="Production payments are blocked"):
        Settings(**common, PAYMENT_ENV="production")
    with pytest.raises(ValidationError, match="PAYMENT_SANDBOX_ENABLED=true"):
        Settings(**{**common, "PAYMENT_SANDBOX_ENABLED": False}, PAYMENT_ENV="test")


def test_internal_sandbox_is_also_blocked_in_production() -> None:
    with pytest.raises(ValidationError, match="Production payments are blocked"):
        Settings(
            _env_file=None,
            PAYMENT_PROVIDER="sandbox",
            PAYMENT_ENV="production",
            PAYMENT_SANDBOX_ENABLED=True,
            PAYMENT_WEBHOOK_SECRET="sandbox-secret",
        )
