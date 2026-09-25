from __future__ import annotations

import logging
import json
from decimal import Decimal
from uuid import UUID

from app.core.config import settings
from app.repositories.payment_repository import (
    attach_provider_payment,
    create_checkout_record,
    fail_checkout_payment,
    get_admin_payment_for_reconciliation,
    get_player_payment,
    process_provider_event,
)
from app.services.payments.mercado_pago import MercadoPagoProvider
from app.services.payments.providers import (
    PaymentProvider,
    PaymentProviderError,
    ProviderWebhookEvent,
    SandboxPaymentProvider,
)

logger = logging.getLogger(__name__)


class PaymentConfigurationError(Exception):
    def __init__(self, message: str, code: str = "payment_configuration_error") -> None:
        super().__init__(message)
        self.code = code


class PaymentWebhookError(Exception):
    def __init__(self, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.status_code = status_code


def _sandbox_provider() -> SandboxPaymentProvider:
    if not settings.payment_sandbox_enabled or settings.payment_provider != "sandbox":
        raise PaymentConfigurationError("O checkout online ainda nao esta disponivel.", "provider_unavailable")
    if not settings.payment_webhook_secret:
        raise PaymentConfigurationError("O sandbox de pagamentos nao esta configurado.", "provider_not_configured")
    try:
        return SandboxPaymentProvider(settings.payment_webhook_secret)
    except PaymentProviderError as exc:
        raise PaymentConfigurationError(str(exc), "provider_not_configured") from exc


def _mercado_pago_provider() -> MercadoPagoProvider:
    if not settings.payment_sandbox_enabled or settings.payment_provider != "mercado_pago":
        raise PaymentConfigurationError("O checkout Mercado Pago não está disponível.", "provider_unavailable")
    try:
        return MercadoPagoProvider(
            access_token=settings.mercado_pago_access_token or "",
            webhook_secret=settings.mercado_pago_webhook_secret or "",
            return_url=settings.mercado_pago_effective_return_url,
            timeout_seconds=settings.mercado_pago_http_timeout_seconds,
        )
    except PaymentProviderError as exc:
        raise PaymentConfigurationError(str(exc), "provider_not_configured") from exc


def _configured_provider() -> PaymentProvider:
    if settings.payment_provider == "sandbox":
        return _sandbox_provider()
    if settings.payment_provider == "mercado_pago":
        return _mercado_pago_provider()
    raise PaymentConfigurationError("O checkout online ainda não está disponível.", "provider_unavailable")


def create_checkout(user_id: str, data: dict, payer_email: str | None = None) -> dict:
    payment_method = data["payment_method"]
    provider_name = settings.payment_provider if settings.payment_provider_available else None

    checkout, created = create_checkout_record(
        user_id=user_id,
        court_id=data["court_id"],
        start_at=data["start_at"],
        sport=data["sport"],
        payment_method=payment_method,
        idempotency_key=data["idempotency_key"],
        advance_amount=settings.booking_advance_amount,
        hold_minutes=settings.payment_hold_minutes,
        provider_name=provider_name,
        use_wallet_balance=bool(data.get("use_wallet_balance")),
        quoted_wallet_amount=data.get("quoted_wallet_amount"),
        quoted_provider_amount=data.get("quoted_provider_amount"),
    )
    if checkout["provider"] == "wallet":
        return checkout
    if not created and (checkout["status"] != "pending" or checkout.get("provider_payment_id")):
        return checkout

    try:
        provider = _configured_provider()
    except PaymentConfigurationError:
        fail_checkout_payment(checkout["payment_id"], "provider_unavailable")
        raise
    if provider.name != checkout["provider"]:
        fail_checkout_payment(checkout["payment_id"], "provider_changed")
        raise PaymentConfigurationError(
            "O provider desta tentativa nao esta mais disponivel.",
            "provider_changed",
        )
    try:
        provider_payment = provider.create_payment(
            payment_id=str(checkout["payment_id"]),
            amount=Decimal(checkout["provider_amount"]),
            currency=str(checkout["currency"]),
            expires_at=checkout["expires_at"],
            idempotency_key=data["idempotency_key"],
            payer_email=payer_email,
        )
    except PaymentProviderError as exc:
        if exc.indeterminate:
            logger.warning(
                "payment.creation_indeterminate payment_id=%s provider=%s error_code=%s",
                checkout["payment_id"],
                provider_name,
                exc.code,
            )
            raise PaymentConfigurationError(
                "A criação do pagamento ainda não pôde ser confirmada. Tente novamente.",
                "payment_creation_pending",
            ) from exc
        fail_checkout_payment(checkout["payment_id"], exc.code)
        logger.warning(
            "payment.failed payment_id=%s provider=%s error_code=%s",
            checkout["payment_id"],
            provider_name,
            exc.code,
        )
        raise PaymentConfigurationError(
            "Não foi possível iniciar o pagamento.",
            "payment_creation_failed",
        ) from exc
    except Exception as exc:  # noqa: BLE001 - creation failure safely releases the hold.
        fail_checkout_payment(checkout["payment_id"], type(exc).__name__)
        logger.warning("payment.failed payment_id=%s error_type=%s", checkout["payment_id"], type(exc).__name__)
        raise PaymentConfigurationError("Nao foi possivel iniciar o pagamento.", "payment_creation_failed") from exc

    try:
        attached = attach_provider_payment(
            checkout["payment_id"],
            provider_payment.provider_payment_id,
            provider_payment.checkout_url,
        )
        return {**checkout, **attached}
    except Exception as exc:  # noqa: BLE001 - retry must reuse the provider idempotency key.
        logger.error("payment.provider_reference_pending payment_id=%s error_type=%s", checkout["payment_id"], type(exc).__name__)
        raise PaymentConfigurationError(
            "Nao foi possivel vincular o pagamento. Tente novamente.",
            "payment_reference_pending",
        ) from exc


def process_webhook(
    provider_name: str,
    payload: bytes,
    signature: str | None,
    *,
    request_id: str | None = None,
    data_id: str | None = None,
    topic: str | None = None,
) -> dict:
    try:
        provider = _configured_provider()
    except PaymentConfigurationError as exc:
        raise PaymentWebhookError(str(exc), 503) from exc
    if provider.name != provider_name:
        raise PaymentWebhookError("Payment provider is not enabled.")
    try:
        event = provider.verify_webhook(
            payload,
            signature,
            request_id=request_id,
            data_id=data_id,
            topic=topic,
        )
    except PaymentProviderError as exc:
        logger.warning("payment.webhook.rejected provider=%s", provider_name)
        raise PaymentWebhookError(str(exc), 503 if exc.retryable else 401) from exc
    logger.info("payment.webhook.received provider=%s event_id=%s", provider_name, event.event_id)
    result = process_provider_event(provider_name, event, payload)
    if result["result"] in {"amount_mismatch", "external_reference_mismatch", "unknown_payment"}:
        raise PaymentWebhookError("Webhook does not match a known payment.")
    return result


def reconcile_mercado_pago_payment(payment_id: UUID) -> dict:
    payment = get_admin_payment_for_reconciliation(payment_id)
    if payment["provider"] != "mercado_pago" or not payment.get("provider_payment_id"):
        raise PaymentConfigurationError(
            "Este pagamento não possui uma Order do Mercado Pago.",
            "provider_payment_missing",
        )
    provider = _mercado_pago_provider()
    try:
        state = provider.get_payment(str(payment["provider_payment_id"]))
    except PaymentProviderError as exc:
        raise PaymentConfigurationError(str(exc), exc.code) from exc
    event = ProviderWebhookEvent(
        event_id=f"reconcile:{state.provider_payment_id}:{state.status}:{state.status_detail}",
        provider_payment_id=state.provider_payment_id,
        status=state.status,
        amount=state.amount,
        currency=state.currency,
        external_reference=state.external_reference,
    )
    audit_payload = json.dumps(
        {
            "source": "admin_reconciliation",
            "provider_order_id": state.provider_payment_id,
            "status": state.status,
            "status_detail": state.status_detail,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    result = process_provider_event("mercado_pago", event, audit_payload)
    if result["result"] in {"amount_mismatch", "external_reference_mismatch", "unknown_payment"}:
        raise PaymentConfigurationError(
            "A Order não corresponde ao pagamento PlayArena.",
            result["result"],
        )
    return {**result, "provider_status": state.status, "status_detail": state.status_detail}


def complete_sandbox_payment(user_id: str, payment_id: UUID, outcome: str) -> dict:
    provider = _sandbox_provider()
    payment = get_player_payment(user_id, payment_id)
    if payment["provider"] != "sandbox" or not payment.get("provider_payment_id"):
        raise PaymentConfigurationError("Pagamento sandbox invalido.")
    payload, signature = provider.signed_event(
        event_id=f"sandbox:{payment_id}:{outcome}",
        provider_payment_id=payment["provider_payment_id"],
        status=outcome,  # type: ignore[arg-type]
        amount=Decimal(payment["provider_amount"]),
        currency=payment["currency"],
    )
    return process_webhook("sandbox", payload, signature)
