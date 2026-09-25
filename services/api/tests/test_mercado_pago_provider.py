import hashlib
import hmac
import json
import logging
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
from app.services.payments import service as payment_service

PAYMENT_ID = "60000000-0000-0000-0000-000000000001"
ORDER_ID = "ORD01PLAYARENA00000000000001"
WEBHOOK_SECRET = "webhook-test-secret"


def order_payload(
    *,
    status: str = "action_required",
    status_detail: str = "waiting_transfer",
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
        "country_code": "BRA",
        "user_id": 123456,
        "external_reference": external_reference,
        "transactions": {"payments": [{
            "id": "PAYTST01PLAYARENA",
            "amount": amount,
            "status": status,
            "status_detail": status_detail,
            "payment_method": {
                "id": "pix",
                "type": "bank_transfer",
                "qr_code": "000201-pix-code",
                "qr_code_base64": "aVZCT1J3MEtHZ28=",
            },
        }]},
    }


def provider(handler) -> MercadoPagoProvider:
    def guarded_handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.mercadolibre.com":
            assert request.url.path == "/users/me"
            return httpx.Response(200, json={"id": 123456})
        return handler(request)

    return MercadoPagoProvider(
        access_token="APP_USR_TEST_ONLY",
        webhook_secret=WEBHOOK_SECRET,
        test_seller_id="123456",
        transport=httpx.MockTransport(guarded_handler),
        sleeper=lambda _seconds: None,
    )


def signed_webhook(
    *,
    live_mode: bool = False,
    signature_override: str | None = None,
    include_event_id: bool = True,
    body_data_id: str = ORDER_ID,
    secret: str = WEBHOOK_SECRET,
):
    request_id = "request-123"
    timestamp = "1760000000000"
    event = {
        "type": "order",
        "action": "order.action_required",
        "live_mode": live_mode,
        "user_id": 123456,
        "data": {"id": body_data_id, "status": "action_required", "status_detail": "waiting_transfer"},
    }
    if include_event_id:
        event["id"] = "notification-123"
    body = json.dumps(event, separators=(",", ":")).encode()
    manifest = f"id:{ORDER_ID.lower()};request-id:{request_id};ts:{timestamp};"
    digest = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return body, signature_override or f"ts={timestamp},v1={digest}", request_id


def test_create_order_uses_backend_values_idempotency_and_transparent_pix() -> None:
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
    assert body["processing_mode"] == "automatic"
    assert body["transactions"]["payments"][0]["payment_method"] == {
        "id": "pix", "type": "bank_transfer",
    }
    assert body["transactions"]["payments"][0]["amount"] == "5.00"
    assert body["transactions"]["payments"][0]["expiration_time"] == "PT30M"
    assert body["external_reference"] == PAYMENT_ID
    assert body["payer"] == {"email": "buyer@testuser.com"}
    assert result.provider_payment_id == ORDER_ID
    assert result.checkout_url is None
    assert result.instructions and result.instructions.copy_paste == "000201-pix-code"
    assert result.instructions.amount == Decimal("5.00")


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
    assert state.payment_method == "pix"


def test_create_order_rejects_wrong_payment_method() -> None:
    payload = order_payload()
    payload["transactions"]["payments"][0]["payment_method"]["id"] = "credit_card"
    with pytest.raises(PaymentProviderError) as error:
        provider(lambda _request: httpx.Response(201, json=payload)).create_payment(
            payment_id=PAYMENT_ID,
            amount=Decimal("5.00"),
            currency="BRL",
            expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
            idempotency_key="checkout_1234567890abcdef",
            payer_email="buyer@testuser.com",
        )
    assert error.value.code == "provider_response_mismatch"


@pytest.mark.parametrize(
    ("provider_status", "status_detail", "expected"),
    [
        ("created", "created", "pending"),
        ("processing", "in_process", "pending"),
        ("failed", "high_risk", "failed"),
        ("canceled", "canceled", "cancelled"),
        ("expired", "expired", "expired"),
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


def test_create_order_rejects_non_test_order() -> None:
    payload = order_payload()
    payload["user_id"] = 999999

    with pytest.raises(PaymentProviderError) as error:
        provider(lambda _request: httpx.Response(201, json=payload)).create_payment(
            payment_id=PAYMENT_ID,
            amount=Decimal("5.00"),
            currency="BRL",
            expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
            idempotency_key="checkout_1234567890abcdef",
            payer_email="buyer@testuser.com",
        )

    assert error.value.code == "production_payment_blocked"
    assert error.value.indeterminate


def test_wrong_seller_credential_is_blocked_before_pix_creation() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={"id": 999999})

    adapter = MercadoPagoProvider(
        access_token="APP_USR_WRONG_SELLER",
        webhook_secret=WEBHOOK_SECRET,
        test_seller_id="123456",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(PaymentProviderError) as error:
        adapter.create_payment(
            payment_id=PAYMENT_ID,
            amount=Decimal("5.00"),
            currency="BRL",
            expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
            idempotency_key="checkout_1234567890abcdef",
            payer_email="buyer@testuser.com",
        )
    assert error.value.code == "production_payment_blocked"
    assert calls == ["/users/me"]


def test_create_order_accepts_copy_code_without_qr_image() -> None:
    payload = order_payload()
    payload["transactions"]["payments"][0]["payment_method"]["qr_code_base64"] = ""
    result = provider(lambda _request: httpx.Response(201, json=payload)).create_payment(
        payment_id=PAYMENT_ID,
        amount=Decimal("5.00"),
        currency="BRL",
        expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
        idempotency_key="checkout_1234567890abcdef",
        payer_email="buyer@testuser.com",
    )
    assert result.instructions and result.instructions.copy_paste == "000201-pix-code"
    assert result.instructions.qr_code_base64 == ""


def test_async_order_can_be_attached_before_pix_instructions_arrive() -> None:
    payload = order_payload(status="processing", status_detail="processing")
    payload["transactions"] = {"payments": []}
    result = provider(lambda _request: httpx.Response(201, json=payload)).create_payment(
        payment_id=PAYMENT_ID,
        amount=Decimal("5.00"),
        currency="BRL",
        expires_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
        idempotency_key="checkout_1234567890abcdef",
        payer_email="buyer@testuser.com",
    )
    assert result.provider_payment_id == ORDER_ID
    assert result.instructions is None


def test_order_without_currency_or_brazil_country_is_rejected() -> None:
    payload = order_payload()
    payload.pop("currency")
    payload.pop("country_code")
    with pytest.raises(PaymentProviderError) as error:
        provider(lambda _request: httpx.Response(200, json=payload)).get_payment(ORDER_ID)
    assert error.value.code == "provider_invalid_response"


def test_order_uses_brazil_country_when_currency_is_omitted() -> None:
    payload = order_payload()
    payload.pop("currency")
    state = provider(lambda _request: httpx.Response(200, json=payload)).get_payment(ORDER_ID)
    assert state.currency == "BRL"


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


def test_real_order_webhook_without_notification_id_is_pending(
    create_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.services.payments.mercado_pago")
    calls = []
    events = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json=order_payload())

    monkeypatch.setattr(payment_routes, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(payment_service, "_configured_provider", lambda: provider(handler))

    def fake_process_provider_event(provider_name, event, payload):
        events.append((provider_name, event, payload))
        return {"result": "processed", "status": event.status}

    monkeypatch.setattr(payment_service, "process_provider_event", fake_process_provider_event)
    body, signature, request_id = signed_webhook(include_event_id=False)
    response = create_client.post(
        f"/payments/webhooks/mercado-pago?data.id={ORDER_ID}&type=order",
        headers={"x-signature": signature, "x-request-id": request_id},
        content=body,
    )

    assert response.status_code == 200
    assert response.json() == {"result": "processed", "status": "pending"}
    assert calls == [f"/v1/orders/{ORDER_ID}"]
    assert events[0][0] == "mercado_pago"
    assert events[0][1].status == "pending"
    assert events[0][1].event_id.startswith("order:")
    assert events[0][2] == body
    assert "mercado_pago.webhook.signature_check" in caplog.text
    assert f"normalized_data_id='{ORDER_ID.lower()}'" in caplog.text
    assert "payment_env=test live_mode=false" in caplog.text
    assert WEBHOOK_SECRET not in caplog.text


def test_real_order_webhook_event_id_is_stable_without_top_level_id() -> None:
    body, signature, request_id = signed_webhook(include_event_id=False)
    adapter = provider(lambda _request: httpx.Response(200, json=order_payload()))

    first = adapter.verify_webhook(body, signature, request_id=request_id, data_id=ORDER_ID, topic="order")
    second = adapter.verify_webhook(body, signature, request_id=request_id, data_id=ORDER_ID, topic="order")

    assert first.event_id == second.event_id


@pytest.mark.parametrize(
    ("query_id", "headers", "secret", "expected_status"),
    [
        (None, {"x-signature", "x-request-id"}, WEBHOOK_SECRET, 401),
        (ORDER_ID, {"x-signature", "x-request-id"}, "wrong-secret", 401),
        (ORDER_ID, {"x-signature"}, WEBHOOK_SECRET, 401),
        (ORDER_ID, {"x-request-id"}, WEBHOOK_SECRET, 401),
    ],
)
def test_real_order_webhook_rejects_missing_query_or_invalid_headers(
    create_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    query_id: str | None,
    headers: set[str],
    secret: str,
    expected_status: int,
) -> None:
    monkeypatch.setattr(payment_routes, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        payment_service,
        "_configured_provider",
        lambda: provider(lambda _request: pytest.fail("GET must not run")),
    )
    body, signature, request_id = signed_webhook(include_event_id=False, secret=secret)
    request_headers = {}
    if "x-signature" in headers:
        request_headers["x-signature"] = signature
    if "x-request-id" in headers:
        request_headers["x-request-id"] = request_id
    query = f"data.id={query_id}&type=order" if query_id else "type=order"

    response = create_client.post(
        f"/payments/webhooks/mercado-pago?{query}", headers=request_headers, content=body,
    )

    assert response.status_code == expected_status


@pytest.mark.parametrize("signature", ["v1=" + "0" * 64, "ts=1760000000000", "ts=1,v1=bad"])
def test_webhook_rejects_incomplete_signature_fields(signature: str) -> None:
    body, _, request_id = signed_webhook()
    with pytest.raises(PaymentProviderError, match="signature"):
        provider(lambda _request: pytest.fail("GET must not run")).verify_webhook(
            body, signature, request_id=request_id, data_id=ORDER_ID, topic="order",
        )


def test_webhook_accepts_reordered_signature_fields() -> None:
    body, signature, request_id = signed_webhook()
    event = provider(lambda _request: httpx.Response(200, json=order_payload())).verify_webhook(
        body, ",".join(reversed(signature.split(","))),
        request_id=request_id, data_id=ORDER_ID, topic="order",
    )
    assert event.status == "pending"


def test_webhook_signature_uses_query_id_not_body_id() -> None:
    body, signature, request_id = signed_webhook(body_data_id="DIFFERENT")
    with pytest.raises(PaymentProviderError, match="payload"):
        provider(lambda _request: pytest.fail("GET must not run")).verify_webhook(
            body, signature, request_id=request_id, data_id=ORDER_ID, topic="order",
        )


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
            payer_email="buyer@testuser.com",
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
            payer_email="buyer@testuser.com",
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
        "MERCADO_PAGO_TEST_SELLER_ID": "123456",
        "FRONTEND_URL": "https://useplayarena.com.br",
    }
    with pytest.raises(ValidationError, match="Production payments are blocked"):
        Settings(**common, PAYMENT_ENV="production")
    with pytest.raises(ValidationError, match="PAYMENT_SANDBOX_ENABLED=true"):
        Settings(**{**common, "PAYMENT_SANDBOX_ENABLED": False}, PAYMENT_ENV="test")
    with pytest.raises(ValidationError, match="MERCADO_PAGO_TEST_SELLER_ID"):
        Settings(**{**common, "MERCADO_PAGO_TEST_SELLER_ID": None}, PAYMENT_ENV="test")


def test_internal_sandbox_is_also_blocked_in_production() -> None:
    with pytest.raises(ValidationError, match="Production payments are blocked"):
        Settings(
            _env_file=None,
            PAYMENT_PROVIDER="sandbox",
            PAYMENT_ENV="production",
            PAYMENT_SANDBOX_ENABLED=True,
            PAYMENT_WEBHOOK_SECRET="sandbox-secret",
        )
