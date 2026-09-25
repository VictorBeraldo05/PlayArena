from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal, Protocol


class PaymentProviderError(Exception):
    """Raised when a provider cannot safely create or validate a payment."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "provider_error",
        retryable: bool = False,
        indeterminate: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.indeterminate = indeterminate


@dataclass(frozen=True)
class PaymentInstructions:
    type: Literal["pix"]
    amount: Decimal
    status: Literal["pending", "paid", "failed", "expired", "cancelled"]
    qr_code: str
    qr_code_base64: str
    copy_paste: str
    expires_at: datetime | None


@dataclass(frozen=True)
class ProviderPayment:
    provider_payment_id: str
    checkout_url: str | None
    instructions: PaymentInstructions | None = None


@dataclass(frozen=True)
class ProviderPaymentState:
    provider_payment_id: str
    status: Literal["pending", "paid", "failed", "expired", "cancelled"]
    status_detail: str
    amount: Decimal
    currency: str
    external_reference: str
    instructions: PaymentInstructions | None = None
    payment_method: str | None = None


@dataclass(frozen=True)
class ProviderWebhookEvent:
    event_id: str
    provider_payment_id: str
    status: Literal["pending", "paid", "failed", "expired", "cancelled"]
    amount: Decimal
    currency: str
    external_reference: str | None = None
    payment_method: str | None = None


class PaymentProvider(Protocol):
    name: str

    def create_payment(
        self,
        *,
        payment_id: str,
        amount: Decimal,
        currency: str,
        expires_at: datetime,
        idempotency_key: str,
        payer_email: str | None = None,
    ) -> ProviderPayment: ...

    def get_payment(self, provider_payment_id: str) -> ProviderPaymentState: ...

    def verify_webhook(
        self,
        payload: bytes,
        signature: str | None,
        *,
        request_id: str | None = None,
        data_id: str | None = None,
        topic: str | None = None,
    ) -> ProviderWebhookEvent: ...


class SandboxPaymentProvider:
    name = "sandbox"

    def __init__(self, secret: str) -> None:
        if not secret:
            raise PaymentProviderError("Sandbox webhook secret is not configured.")
        self._secret = secret.encode("utf-8")

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
        del amount, currency, expires_at, idempotency_key, payer_email
        return ProviderPayment(provider_payment_id=f"sandbox_{payment_id}", checkout_url=None)

    def get_payment(self, provider_payment_id: str) -> ProviderPaymentState:
        del provider_payment_id
        raise PaymentProviderError("Sandbox status is delivered by its signed event.")

    def verify_webhook(
        self,
        payload: bytes,
        signature: str | None,
        *,
        request_id: str | None = None,
        data_id: str | None = None,
        topic: str | None = None,
    ) -> ProviderWebhookEvent:
        del request_id, data_id, topic
        expected = hmac.new(self._secret, payload, hashlib.sha256).hexdigest()
        supplied = (signature or "").removeprefix("sha256=")
        if not supplied or not hmac.compare_digest(expected, supplied):
            raise PaymentProviderError("Invalid webhook signature.")
        try:
            data = json.loads(payload)
            status = str(data["status"])
            if status not in {"paid", "failed"}:
                raise ValueError("unsupported status")
            return ProviderWebhookEvent(
                event_id=str(data["event_id"]),
                provider_payment_id=str(data["payment_id"]),
                status=status,  # type: ignore[arg-type]
                amount=Decimal(str(data["amount"])),
                currency=str(data["currency"]),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise PaymentProviderError("Invalid webhook payload.") from exc

    def signed_event(
        self,
        *,
        event_id: str,
        provider_payment_id: str,
        status: Literal["paid", "failed"],
        amount: Decimal,
        currency: str,
    ) -> tuple[bytes, str]:
        payload = json.dumps(
            {
                "event_id": event_id,
                "payment_id": provider_payment_id,
                "status": status,
                "amount": format(amount, ".2f"),
                "currency": currency,
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        signature = hmac.new(self._secret, payload, hashlib.sha256).hexdigest()
        return payload, f"sha256={signature}"
