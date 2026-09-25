from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx

from app.services.payments.providers import (
    PaymentProviderError,
    ProviderPayment,
    ProviderPaymentState,
    ProviderWebhookEvent,
)

logger = logging.getLogger(__name__)

MERCADO_PAGO_API_URL = "https://api.mercadopago.com"
TRANSIENT_STATUS_CODES = {408, 423, 429, 500, 502, 503, 504}


class MercadoPagoProvider:
    """Checkout Pro Orders adapter locked to PlayArena's test environment."""

    name = "mercado_pago"

    def __init__(
        self,
        *,
        access_token: str,
        webhook_secret: str,
        return_url: str,
        timeout_seconds: float = 5.0,
        transport: httpx.BaseTransport | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        if not access_token:
            raise PaymentProviderError("Mercado Pago access token is not configured.")
        if not webhook_secret:
            raise PaymentProviderError("Mercado Pago webhook secret is not configured.")
        parsed_return_url = urlparse(return_url)
        if parsed_return_url.scheme != "https" or not parsed_return_url.netloc:
            raise PaymentProviderError("Mercado Pago return URL must be an absolute HTTPS URL.")
        self._access_token = access_token
        self._webhook_secret = webhook_secret.encode("utf-8")
        self._return_url = return_url
        self._timeout = httpx.Timeout(timeout_seconds)
        self._transport = transport
        self._sleeper = sleeper

    def create_payment(
        self,
        *,
        payment_id: str,
        amount: Decimal,
        currency: str,
        expires_at: datetime,
        idempotency_key: str,
        payer_email: str | None = None,
    ) -> ProviderPayment:
        del expires_at
        normalized_amount = _money(amount)
        if currency != "BRL" or normalized_amount <= 0:
            raise PaymentProviderError("Mercado Pago order requires a positive BRL amount.")
        payload: dict[str, Any] = {
            "type": "online",
            "processing_mode": "manual",
            "capture_mode": "automatic_async",
            "total_amount": format(normalized_amount, ".2f"),
            "external_reference": payment_id,
            "description": "Reserva PlayArena",
            "items": [
                {
                    "title": "Reserva PlayArena",
                    "quantity": 1,
                    "unit_measure": "unit",
                    "unit_price": format(normalized_amount, ".2f"),
                    "total_amount": format(normalized_amount, ".2f"),
                }
            ],
            "config": {
                "online": {
                    "success_url": self._build_return_url(payment_id, "success"),
                    "failure_url": self._build_return_url(payment_id, "failure"),
                    "pending_url": self._build_return_url(payment_id, "pending"),
                    "auto_return": "all",
                }
            },
        }
        if payer_email:
            payload["payer"] = {"email": payer_email}

        data = self._request_json(
            "POST",
            "/v1/orders",
            json_body=payload,
            idempotency_key=idempotency_key,
            indeterminate_on_failure=True,
        )
        state = self._parse_order(data)
        self._require_test_order(state.provider_payment_id, indeterminate=True)
        if state.external_reference != payment_id:
            raise PaymentProviderError(
                "Mercado Pago returned an unexpected external reference.",
                code="provider_response_mismatch",
                indeterminate=True,
            )
        if state.amount != normalized_amount or state.currency != currency:
            raise PaymentProviderError(
                "Mercado Pago returned unexpected order values.",
                code="provider_response_mismatch",
                indeterminate=True,
            )
        checkout_url = data.get("checkout_url")
        if not isinstance(checkout_url, str) or not _is_mercado_pago_checkout_url(checkout_url):
            raise PaymentProviderError(
                "Mercado Pago did not return a safe checkout URL.",
                code="provider_response_mismatch",
                indeterminate=True,
            )
        if data.get("live_mode") is True:
            raise PaymentProviderError(
                "Production Mercado Pago orders are blocked.",
                code="production_payment_blocked",
                indeterminate=True,
            )
        logger.info(
            "payment.provider_order_created provider=mercado_pago provider_order_id=%s payment_id=%s",
            state.provider_payment_id,
            payment_id,
        )
        return ProviderPayment(state.provider_payment_id, checkout_url)

    def get_payment(self, provider_payment_id: str) -> ProviderPaymentState:
        if not provider_payment_id or "/" in provider_payment_id:
            raise PaymentProviderError("Invalid Mercado Pago order id.")
        data = self._request_json("GET", f"/v1/orders/{provider_payment_id}")
        state = self._parse_order(data)
        if state.provider_payment_id != provider_payment_id:
            raise PaymentProviderError(
                "Mercado Pago returned a different order id.",
                code="provider_response_mismatch",
            )
        self._require_test_order(state.provider_payment_id)
        if data.get("live_mode") is True:
            raise PaymentProviderError(
                "Production Mercado Pago orders are blocked.",
                code="production_payment_blocked",
            )
        logger.info(
            "payment.provider_status provider=mercado_pago provider_order_id=%s status=%s",
            provider_payment_id,
            state.status,
        )
        return state

    def verify_webhook(
        self,
        payload: bytes,
        signature: str | None,
        *,
        request_id: str | None = None,
        data_id: str | None = None,
        topic: str | None = None,
    ) -> ProviderWebhookEvent:
        if not signature or not request_id or not data_id:
            raise PaymentProviderError("Mercado Pago webhook metadata is incomplete.")
        if topic != "order":
            raise PaymentProviderError("Unsupported Mercado Pago webhook topic.")
        self._verify_signature(signature, request_id, data_id)
        try:
            body = json.loads(payload)
            if not isinstance(body, dict):
                raise ValueError("body")
            event_id = str(body["id"])
            body_data = body["data"]
            if not isinstance(body_data, dict) or str(body_data["id"]) != data_id:
                raise ValueError("data.id")
            if body.get("type") != "order":
                raise ValueError("type")
            if body.get("live_mode") is not False:
                raise PaymentProviderError(
                    "Production Mercado Pago webhook is blocked.",
                    code="production_payment_blocked",
                )
        except PaymentProviderError:
            raise
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise PaymentProviderError("Invalid Mercado Pago webhook payload.") from exc

        state = self.get_payment(data_id)
        return ProviderWebhookEvent(
            event_id=event_id,
            provider_payment_id=state.provider_payment_id,
            status=state.status,
            amount=state.amount,
            currency=state.currency,
            external_reference=state.external_reference,
        )

    def _verify_signature(self, signature: str, request_id: str, data_id: str) -> None:
        parts: dict[str, str] = {}
        for raw_part in signature.split(","):
            key, separator, value = raw_part.strip().partition("=")
            if separator and key and value:
                parts[key] = value
        timestamp = parts.get("ts")
        supplied = parts.get("v1")
        if not timestamp or not supplied or len(supplied) != 64:
            raise PaymentProviderError("Invalid Mercado Pago webhook signature.")
        manifest = f"id:{data_id};request-id:{request_id};ts:{timestamp};"
        expected = hmac.new(self._webhook_secret, manifest.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, supplied):
            raise PaymentProviderError("Invalid Mercado Pago webhook signature.")

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        indeterminate_on_failure: bool = False,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
            "User-Agent": "PlayArena/1.0",
        }
        if idempotency_key:
            headers["X-Idempotency-Key"] = idempotency_key

        with httpx.Client(
            base_url=MERCADO_PAGO_API_URL,
            headers=headers,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            for attempt in range(2):
                try:
                    response = client.request(method, path, json=json_body)
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    if attempt == 0:
                        self._sleeper(0.2)
                        continue
                    raise PaymentProviderError(
                        "Mercado Pago request timed out.",
                        code="provider_timeout",
                        retryable=True,
                        indeterminate=indeterminate_on_failure,
                    ) from exc
                if response.status_code in TRANSIENT_STATUS_CODES:
                    if attempt == 0:
                        self._sleeper(0.2)
                        continue
                    raise PaymentProviderError(
                        f"Mercado Pago is temporarily unavailable ({response.status_code}).",
                        code="provider_unavailable",
                        retryable=True,
                        indeterminate=indeterminate_on_failure,
                    )
                if response.status_code >= 400:
                    raise PaymentProviderError(
                        f"Mercado Pago rejected the request ({response.status_code}).",
                        code="provider_rejected",
                    )
                try:
                    data = response.json()
                except ValueError as exc:
                    raise PaymentProviderError(
                        "Mercado Pago returned invalid JSON.",
                        code="provider_invalid_response",
                        indeterminate=indeterminate_on_failure,
                    ) from exc
                if not isinstance(data, dict):
                    raise PaymentProviderError(
                        "Mercado Pago returned an invalid response.",
                        code="provider_invalid_response",
                        indeterminate=indeterminate_on_failure,
                    )
                return data
        raise AssertionError("unreachable")

    def _parse_order(self, data: dict[str, Any]) -> ProviderPaymentState:
        try:
            provider_payment_id = str(data["id"])
            provider_status = str(data["status"])
            status_detail = str(data.get("status_detail") or "")
            amount = _money(data["total_amount"])
            currency = str(data["currency"])
            external_reference = str(data["external_reference"])
        except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
            raise PaymentProviderError(
                "Mercado Pago order response is incomplete.",
                code="provider_invalid_response",
            ) from exc

        if provider_status == "processed" and status_detail == "accredited":
            status = "paid"
        elif provider_status == "failed":
            status = "failed"
        elif provider_status in {"canceled", "expired", "refunded"} or status_detail in {
            "expired",
            "refunded",
            "partially_refunded",
        }:
            status = "cancelled"
        else:
            status = "pending"
        return ProviderPaymentState(
            provider_payment_id=provider_payment_id,
            status=status,
            status_detail=status_detail,
            amount=amount,
            currency=currency,
            external_reference=external_reference,
        )

    @staticmethod
    def _require_test_order(provider_payment_id: str, *, indeterminate: bool = False) -> None:
        if not provider_payment_id.startswith("ORDTST"):
            raise PaymentProviderError(
                "Production Mercado Pago orders are blocked.",
                code="production_payment_blocked",
                indeterminate=indeterminate,
            )

    def _build_return_url(self, payment_id: str, result: str) -> str:
        parsed = urlparse(self._return_url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query.update({"payment_id": payment_id, "result": result})
        return urlunparse(parsed._replace(query=urlencode(query)))


def _money(value: object) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _is_mercado_pago_checkout_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (
        host == "mercadopago.com.br" or host.endswith(".mercadopago.com.br")
    )
