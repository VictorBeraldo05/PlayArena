import inspect
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from app.api.routes import payments
from app.repositories import booking_repository, owner_repository, payment_repository
from app.repositories.payment_repository import WalletInsufficientBalanceError
from app.schemas.auth import AuthenticatedUser
from app.schemas.payment import CheckoutCreate
from app.services.notifications.templates import ReservationEmailData, render_reservation_email
from app.services.payments import service
from app.services.payments.providers import (
    PaymentProviderError,
    ProviderPayment,
    ProviderPaymentState,
    ProviderWebhookEvent,
    SandboxPaymentProvider,
)

PLAYER = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000a", email="player@playarena.dev")
PAYMENT_ID = UUID("60000000-0000-0000-0000-000000000001")
START_AT = datetime(2026, 10, 20, 20, 0, tzinfo=timezone.utc)


def checkout_payload(payment_method: str = "provider") -> dict:
    return {
        "court_id": UUID("20000000-0000-0000-0000-000000000001"),
        "start_at": START_AT,
        "sport": "Society",
        "payment_method": payment_method,
        "idempotency_key": "checkout_1234567890abcdef",
    }


def payment_row(**changes) -> dict:
    row = {
        "payment_id": PAYMENT_ID,
        "user_id": PLAYER.id,
        "hold_id": UUID("70000000-0000-0000-0000-000000000001"),
        "reservation_id": None,
        "provider_payment_id": "sandbox_payment",
        "status": "pending",
        "amount": Decimal("5.00"),
        "wallet_amount": Decimal("0.00"),
        "provider_amount": Decimal("5.00"),
        "use_wallet_balance": False,
        "currency": "BRL",
        "arena_id": UUID("10000000-0000-0000-0000-000000000001"),
        "court_id": UUID("20000000-0000-0000-0000-000000000001"),
        "sport_id": 1,
        "customer_name": "Jose",
        "customer_phone": "11999999999",
        "start_at": START_AT,
        "end_at": START_AT + timedelta(hours=1),
        "court_price_total": Decimal("115.00"),
        "booking_amount": Decimal("5.00"),
        "amount_due_at_venue": Decimal("110.00"),
        "hold_status": "active",
        "hold_expired": False,
    }
    return {**row, **changes}


class Result:
    def __init__(self, row=None, scalar=None):
        self.row = row
        self.scalar = scalar

    def mappings(self):
        return self

    def one_or_none(self):
        return self.row

    def one(self):
        return self.row

    def scalar_one(self):
        return self.scalar


class WebhookSession:
    def __init__(self, payment=None, *, duplicate=False, conflict=False):
        self.payment = payment or payment_row()
        self.duplicate = duplicate
        self.conflict = conflict
        self.sql: list[str] = []
        self.params: list[dict | None] = []

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).lower().split())
        self.sql.append(sql)
        self.params.append(params)
        if "insert into public.payment_webhook_events" in sql:
            return Result(None if self.duplicate else {"id": "event-row"})
        if "from public.payments p join public.booking_holds" in sql and "for update" in sql:
            return Result(self.payment)
        if "pg_advisory_xact_lock" in sql:
            return Result()
        if sql.startswith("select exists("):
            return Result(scalar=self.conflict)
        if "insert into public.reservations" in sql:
            return Result({"id": "reservation-id", "status": "pending"})
        if "insert into public.wallet_transactions" in sql:
            return Result({"id": "credit-id"})
        return Result()


class TransactionFactory:
    def __init__(self, session):
        self.session = session

    def begin(self):
        return self

    def __enter__(self):
        return self.session

    def __exit__(self, *_args):
        return False


def webhook_event(
    status="paid",
    amount="5.00",
    currency="BRL",
    external_reference=None,
) -> ProviderWebhookEvent:
    return ProviderWebhookEvent(
        event_id="evt-1",
        provider_payment_id="sandbox_payment",
        status=status,
        amount=Decimal(amount),
        currency=currency,
        external_reference=external_reference,
    )


def test_sandbox_provider_validates_hmac_and_detects_tampering() -> None:
    provider = SandboxPaymentProvider("test-secret")
    payload, signature = provider.signed_event(
        event_id="evt-1",
        provider_payment_id="sandbox_payment",
        status="paid",
        amount=Decimal("5.00"),
        currency="BRL",
    )

    event = provider.verify_webhook(payload, signature)
    assert event.status == "paid"
    assert event.amount == Decimal("5.00")
    with pytest.raises(PaymentProviderError, match="signature"):
        provider.verify_webhook(payload.replace(b'"5.00"', b'"0.01"'), signature)


def test_paid_webhook_creates_one_pending_reservation_with_historical_amounts(monkeypatch) -> None:
    session = WebhookSession()
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event("sandbox", webhook_event(), b'{"signed":true}')

    assert result == {"result": "processed", "status": "paid", "reservation_id": "reservation-id"}
    inserts = [sql for sql in session.sql if "insert into public.reservations" in sql]
    assert len(inserts) == 1
    assert "court_price_total" in inserts[0]
    assert "booking_amount_paid" in inserts[0]
    assert "amount_due_at_venue" in inserts[0]


def test_failed_payment_releases_hold_without_creating_reservation(monkeypatch) -> None:
    session = WebhookSession()
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event("sandbox", webhook_event(status="failed"), b"failed")

    assert result["status"] == "failed"
    assert any("set status='cancelled'" in sql for sql in session.sql)
    assert not any("insert into public.reservations" in sql for sql in session.sql)


def test_duplicate_webhook_is_a_noop(monkeypatch) -> None:
    session = WebhookSession(duplicate=True)
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    assert payment_repository.process_provider_event("sandbox", webhook_event(), b"same") == {"result": "duplicate"}
    assert len(session.sql) == 1


def test_amount_tampering_is_rejected_before_reservation(monkeypatch) -> None:
    session = WebhookSession()
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event("sandbox", webhook_event(amount="0.01"), b"tampered")

    assert result["result"] == "amount_mismatch"
    assert not any("insert into public.reservations" in sql for sql in session.sql)


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        (webhook_event(currency="USD"), "amount_mismatch"),
        (webhook_event(external_reference="different-payment"), "external_reference_mismatch"),
    ],
)
def test_provider_currency_and_external_reference_are_validated(monkeypatch, event, expected) -> None:
    session = WebhookSession()
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event("mercado_pago", event, b"verified-order")

    assert result["result"] == expected
    assert not any("insert into public.reservations" in sql for sql in session.sql)


def test_pending_provider_order_keeps_payment_and_hold_pending(monkeypatch) -> None:
    session = WebhookSession()
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event(
        "mercado_pago",
        webhook_event(status="pending", external_reference=str(PAYMENT_ID)),
        b"pending-order",
    )

    assert result == {"result": "processed", "status": "pending", "reservation_id": None}
    assert not any("update public.payments set status" in sql for sql in session.sql)
    assert not any("insert into public.reservations" in sql for sql in session.sql)


def test_verified_order_recovers_missing_local_provider_reference(monkeypatch) -> None:
    session = WebhookSession(payment_row(provider_payment_id=None))
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event(
        "mercado_pago",
        webhook_event(status="pending", external_reference=str(PAYMENT_ID)),
        b"verified-order",
    )

    assert result["status"] == "pending"
    assert any("set provider_payment_id = :provider_payment_id" in sql for sql in session.sql)


def test_cancelled_provider_order_releases_hold_without_reservation(monkeypatch) -> None:
    session = WebhookSession()
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event(
        "mercado_pago",
        webhook_event(status="cancelled", external_reference=str(PAYMENT_ID)),
        b"cancelled-order",
    )

    assert result["status"] == "cancelled"
    assert any("set status='cancelled'" in sql for sql in session.sql)
    assert not any("insert into public.reservations" in sql for sql in session.sql)


def test_duplicate_mercado_pago_webhook_is_a_noop(monkeypatch) -> None:
    session = WebhookSession(duplicate=True)
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event(
        "mercado_pago",
        webhook_event(external_reference=str(PAYMENT_ID)),
        b"same-mercado-pago-event",
    )

    assert result == {"result": "duplicate"}
    assert len(session.sql) == 1


@pytest.mark.parametrize("payment", [payment_row(hold_expired=True), payment_row(hold_status="expired")])
def test_late_payment_becomes_credit_instead_of_double_booking(monkeypatch, payment) -> None:
    session = WebhookSession(payment)
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event("sandbox", webhook_event(), b"late")

    assert result["reservation_id"] is None
    assert any("insert into public.wallet_transactions" in sql for sql in session.sql)
    assert not any("insert into public.reservations" in sql for sql in session.sql)


def test_provider_payment_arriving_after_payment_expiration_is_still_credited(monkeypatch) -> None:
    session = WebhookSession(payment_row(status="expired", hold_status="expired", hold_expired=True))
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event("sandbox", webhook_event(), b"late-after-poll")

    assert result == {"result": "processed", "status": "paid", "reservation_id": None}
    assert any("insert into public.wallet_transactions" in sql for sql in session.sql)


def test_late_mixed_payment_credits_wallet_and_provider_parts_once(monkeypatch) -> None:
    session = WebhookSession(
        payment_row(
            status="expired",
            hold_status="expired",
            hold_expired=True,
            wallet_amount=Decimal("2.00"),
            provider_amount=Decimal("3.00"),
            use_wallet_balance=True,
        )
    )
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event(
        "sandbox",
        webhook_event(amount="3.00"),
        b"late-mixed-payment",
    )

    assert result["status"] == "paid"
    credit_amounts = [
        params["amount"]
        for sql, params in zip(session.sql, session.params, strict=True)
        if "insert into public.wallet_transactions" in sql and params
    ]
    assert credit_amounts == [Decimal("2.00"), Decimal("3.00")]


def test_concurrent_slot_conflict_protects_payment_with_credit(monkeypatch) -> None:
    session = WebhookSession(conflict=True)
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event("sandbox", webhook_event(), b"conflict")

    assert result["reservation_id"] is None
    assert any("slot_unavailable_credited" in sql for sql in session.sql)


def test_checkout_schema_rejects_price_and_amount_tampering() -> None:
    with pytest.raises(ValidationError):
        CheckoutCreate(**checkout_payload(), amount="0.01")
    with pytest.raises(ValidationError):
        CheckoutCreate(**checkout_payload(), price="1.00")


@pytest.mark.parametrize(
    ("balance", "use_wallet", "wallet_amount", "provider_amount"),
    [
        ("0.00", False, "0.00", "5.00"),
        ("0.00", True, "0.00", "5.00"),
        ("2.00", True, "2.00", "3.00"),
        ("5.00", True, "5.00", "0.00"),
        ("20.00", True, "5.00", "0.00"),
    ],
)
def test_server_calculates_wallet_and_provider_split(
    balance,
    use_wallet,
    wallet_amount,
    provider_amount,
) -> None:
    result = payment_repository.split_checkout_amounts(
        Decimal(balance),
        Decimal("5.00"),
        use_wallet_balance=use_wallet,
    )

    assert result == (Decimal(wallet_amount), Decimal(provider_amount))


def test_mixed_provider_webhook_validates_only_external_amount(monkeypatch) -> None:
    session = WebhookSession(
        payment_row(
            wallet_amount=Decimal("2.00"),
            provider_amount=Decimal("3.00"),
            use_wallet_balance=True,
        )
    )
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event(
        "mercado_pago",
        webhook_event(amount="3.00", external_reference=str(PAYMENT_ID)),
        b"mixed-approved",
    )

    assert result["reservation_id"] == "reservation-id"
    assert not any("checkout-wallet-release" in str(params) for params in session.params)


def test_mixed_provider_failure_releases_wallet_part_once(monkeypatch) -> None:
    session = WebhookSession(
        payment_row(
            wallet_amount=Decimal("2.00"),
            provider_amount=Decimal("3.00"),
            use_wallet_balance=True,
        )
    )
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: TransactionFactory(session))

    result = payment_repository.process_provider_event(
        "mercado_pago",
        webhook_event(status="failed", amount="3.00", external_reference=str(PAYMENT_ID)),
        b"mixed-failed",
    )

    assert result["status"] == "failed"
    wallet_release = [
        params
        for params in session.params
        if params and str(params.get("idempotency_key", "")).startswith("checkout-wallet-release:")
    ]
    assert len(wallet_release) == 1
    assert wallet_release[0]["amount"] == Decimal("2.00")


def test_checkout_route_sources_payer_email_from_authenticated_user(monkeypatch) -> None:
    captured = {}
    request = Request({"type": "http", "client": ("127.0.0.1", 1234), "headers": []})
    monkeypatch.setattr(payments, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        payments,
        "create_checkout",
        lambda user_id, data, payer_email=None: captured.update(
            user_id=user_id,
            data=data,
            payer_email=payer_email,
        )
        or {"status": "pending"},
    )

    result = payments.post_checkout(request, CheckoutCreate(**checkout_payload()), PLAYER)

    assert result == {"status": "pending"}
    assert captured["payer_email"] == PLAYER.email
    assert "payer_email" not in captured["data"]


def test_wallet_checkout_never_calls_external_provider(monkeypatch) -> None:
    captured = {}
    paid = {"payment_id": PAYMENT_ID, "provider": "wallet", "status": "paid", "reservation_id": "reservation-id"}
    monkeypatch.setattr(service, "create_checkout_record", lambda **kwargs: (captured.update(kwargs) or paid, True))
    monkeypatch.setattr(service, "_configured_provider", lambda: (_ for _ in ()).throw(AssertionError("provider called")))

    result = service.create_checkout(PLAYER.id, checkout_payload("wallet"))

    assert result == paid
    assert captured["advance_amount"] == Decimal("5.00")
    assert captured["payment_method"] == "wallet"


def test_provider_creation_failure_marks_payment_failed(monkeypatch) -> None:
    class FailingProvider:
        name = "sandbox"

        def create_payment(self, **_kwargs):
            raise RuntimeError("provider unavailable")

    checkout = {
        "payment_id": PAYMENT_ID,
        "provider": "sandbox",
        "status": "pending",
        "amount": Decimal("5.00"),
        "provider_amount": Decimal("5.00"),
        "currency": "BRL",
        "expires_at": START_AT,
    }
    failed = []
    monkeypatch.setattr(service, "_configured_provider", lambda: FailingProvider())
    monkeypatch.setattr(service, "create_checkout_record", lambda **_kwargs: (checkout, True))
    monkeypatch.setattr(service, "fail_checkout_payment", lambda *args: failed.append(args))

    with pytest.raises(service.PaymentConfigurationError):
        service.create_checkout(PLAYER.id, checkout_payload())
    assert failed and failed[0][0] == PAYMENT_ID


def test_indeterminate_provider_creation_preserves_payment_and_hold(monkeypatch) -> None:
    class IndeterminateProvider:
        name = "mercado_pago"

        def create_payment(self, **_kwargs):
            raise PaymentProviderError(
                "timeout",
                code="provider_timeout",
                retryable=True,
                indeterminate=True,
            )

    checkout = {
        "payment_id": PAYMENT_ID,
        "provider": "mercado_pago",
        "status": "pending",
        "amount": Decimal("5.00"),
        "provider_amount": Decimal("5.00"),
        "currency": "BRL",
        "expires_at": START_AT,
    }
    failed = []
    monkeypatch.setattr(service, "_configured_provider", lambda: IndeterminateProvider())
    monkeypatch.setattr(service, "create_checkout_record", lambda **_kwargs: (checkout, True))
    monkeypatch.setattr(service, "fail_checkout_payment", lambda *args: failed.append(args))

    with pytest.raises(service.PaymentConfigurationError) as error:
        service.create_checkout(PLAYER.id, checkout_payload(), payer_email=PLAYER.email)

    assert error.value.code == "payment_creation_pending"
    assert failed == []


def test_provider_success_attaches_provider_reference(monkeypatch) -> None:
    class Provider:
        name = "sandbox"

        def create_payment(self, **_kwargs):
            return ProviderPayment("sandbox_payment", None)

    checkout = {
        "payment_id": PAYMENT_ID,
        "provider": "sandbox",
        "status": "pending",
        "amount": Decimal("5.00"),
        "provider_amount": Decimal("5.00"),
        "currency": "BRL",
        "expires_at": START_AT,
    }
    monkeypatch.setattr(service, "_configured_provider", lambda: Provider())
    monkeypatch.setattr(service, "create_checkout_record", lambda **_kwargs: (checkout, True))
    monkeypatch.setattr(service, "attach_provider_payment", lambda *args: {**checkout, "provider_payment_id": args[1]})

    result = service.create_checkout(PLAYER.id, checkout_payload())

    assert result["provider_payment_id"] == "sandbox_payment"


def test_mixed_checkout_charges_provider_only_for_remaining_amount(monkeypatch) -> None:
    captured = {}

    class Provider:
        name = "sandbox"

        def create_payment(self, **kwargs):
            captured.update(kwargs)
            return ProviderPayment("sandbox_payment", None)

    checkout = {
        "payment_id": PAYMENT_ID,
        "provider": "sandbox",
        "status": "pending",
        "amount": Decimal("5.00"),
        "wallet_amount": Decimal("2.00"),
        "provider_amount": Decimal("3.00"),
        "currency": "BRL",
        "expires_at": START_AT,
    }
    repository_args = {}
    monkeypatch.setattr(service, "_configured_provider", lambda: Provider())
    monkeypatch.setattr(
        service,
        "create_checkout_record",
        lambda **kwargs: (repository_args.update(kwargs) or checkout, True),
    )
    monkeypatch.setattr(
        service,
        "attach_provider_payment",
        lambda *args: {**checkout, "provider_payment_id": args[1]},
    )

    payload = {
        **checkout_payload(),
        "use_wallet_balance": True,
        "quoted_wallet_amount": Decimal("2.00"),
        "quoted_provider_amount": Decimal("3.00"),
    }
    service.create_checkout(PLAYER.id, payload, payer_email=PLAYER.email)

    assert captured["amount"] == Decimal("3.00")
    assert repository_args["use_wallet_balance"] is True
    assert repository_args["quoted_wallet_amount"] == Decimal("2.00")


def test_mixed_sandbox_completion_signs_only_provider_amount(monkeypatch) -> None:
    captured = {}

    class Provider:
        def signed_event(self, **kwargs):
            captured.update(kwargs)
            return b"payload", "signature"

    monkeypatch.setattr(service, "_sandbox_provider", lambda: Provider())
    monkeypatch.setattr(
        service,
        "get_player_payment",
        lambda *_args: {
            "provider": "sandbox",
            "provider_payment_id": "sandbox_payment",
            "amount": Decimal("5.00"),
            "provider_amount": Decimal("3.00"),
            "currency": "BRL",
        },
    )
    monkeypatch.setattr(service, "process_webhook", lambda *_args: {"result": "processed"})

    result = service.complete_sandbox_payment(PLAYER.id, PAYMENT_ID, "paid")

    assert result == {"result": "processed"}
    assert captured["amount"] == Decimal("3.00")


def test_provider_configuration_failure_releases_wallet_and_hold(monkeypatch) -> None:
    checkout = {
        "payment_id": PAYMENT_ID,
        "provider": "mercado_pago",
        "status": "pending",
        "wallet_amount": Decimal("2.00"),
        "provider_amount": Decimal("3.00"),
    }
    failed = []
    monkeypatch.setattr(service, "create_checkout_record", lambda **_kwargs: (checkout, True))
    monkeypatch.setattr(
        service,
        "_configured_provider",
        lambda: (_ for _ in ()).throw(service.PaymentConfigurationError("missing provider")),
    )
    monkeypatch.setattr(service, "fail_checkout_payment", lambda *args: failed.append(args))

    with pytest.raises(service.PaymentConfigurationError):
        service.create_checkout(PLAYER.id, checkout_payload())

    assert failed == [(PAYMENT_ID, "provider_unavailable")]


def test_pending_checkout_without_provider_reference_is_retried_idempotently(monkeypatch) -> None:
    class Provider:
        name = "sandbox"

        def create_payment(self, **kwargs):
            assert kwargs["idempotency_key"] == checkout_payload()["idempotency_key"]
            return ProviderPayment("sandbox_payment", None)

    checkout = {
        "payment_id": PAYMENT_ID,
        "provider": "sandbox",
        "provider_payment_id": None,
        "status": "pending",
        "amount": Decimal("5.00"),
        "provider_amount": Decimal("5.00"),
        "currency": "BRL",
        "expires_at": START_AT,
    }
    monkeypatch.setattr(service, "_configured_provider", lambda: Provider())
    monkeypatch.setattr(service, "create_checkout_record", lambda **_kwargs: (checkout, False))
    monkeypatch.setattr(service, "attach_provider_payment", lambda *args: {**checkout, "provider_payment_id": args[1]})

    assert service.create_checkout(PLAYER.id, checkout_payload())["provider_payment_id"] == "sandbox_payment"


def test_provider_reference_failure_preserves_pending_payment_for_safe_retry(monkeypatch) -> None:
    class Provider:
        name = "sandbox"

        def create_payment(self, **_kwargs):
            return ProviderPayment("sandbox_payment", None)

    checkout = {
        "payment_id": PAYMENT_ID,
        "provider": "sandbox",
        "status": "pending",
        "amount": Decimal("5.00"),
        "provider_amount": Decimal("5.00"),
        "currency": "BRL",
        "expires_at": START_AT,
    }
    failed = []
    monkeypatch.setattr(service, "_configured_provider", lambda: Provider())
    monkeypatch.setattr(service, "create_checkout_record", lambda **_kwargs: (checkout, True))
    monkeypatch.setattr(
        service,
        "attach_provider_payment",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("database unavailable")),
    )
    monkeypatch.setattr(service, "fail_checkout_payment", lambda *args: failed.append(args))

    with pytest.raises(service.PaymentConfigurationError) as error:
        service.create_checkout(PLAYER.id, checkout_payload())

    assert error.value.code == "payment_reference_pending"
    assert failed == []


def test_admin_reconciliation_uses_provider_state_and_shared_event_processor(monkeypatch) -> None:
    class Provider:
        def get_payment(self, provider_payment_id):
            assert provider_payment_id == "ORD-123"
            return ProviderPaymentState(
                provider_payment_id="ORD-123",
                status="paid",
                status_detail="accredited",
                amount=Decimal("5.00"),
                currency="BRL",
                external_reference=str(PAYMENT_ID),
            )

    captured = {}
    monkeypatch.setattr(
        service,
        "get_admin_payment_for_reconciliation",
        lambda _payment_id: {
            "payment_id": PAYMENT_ID,
            "provider": "mercado_pago",
            "provider_payment_id": "ORD-123",
        },
    )
    monkeypatch.setattr(service, "_mercado_pago_provider", lambda: Provider())
    monkeypatch.setattr(
        service,
        "process_provider_event",
        lambda provider_name, event, payload: captured.update(
            provider_name=provider_name,
            event=event,
            payload=payload,
        )
        or {"result": "processed", "status": "paid", "reservation_id": "reservation-id"},
    )

    result = service.reconcile_mercado_pago_payment(PAYMENT_ID)

    assert result["provider_status"] == "paid"
    assert captured["provider_name"] == "mercado_pago"
    assert captured["event"].external_reference == str(PAYMENT_ID)
    assert b"admin_reconciliation" in captured["payload"]


def test_player_wallet_endpoint_can_only_request_authenticated_users_wallet(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(payments, "get_wallet", lambda user_id: captured.update(user_id=user_id) or {"balance": 0, "transactions": []})

    payments.player_wallet(PLAYER)

    assert captured == {"user_id": PLAYER.id}
    with pytest.raises(HTTPException) as error:
        payments.require_player(PLAYER, "arena_owner")
    assert error.value.status_code == 403


def test_wallet_insufficient_balance_has_semantic_error() -> None:
    error = payments._checkout_error(WalletInsufficientBalanceError())
    assert error.status_code == 409
    assert error.detail["code"] == "wallet_insufficient"


class RefundSession:
    def __init__(self):
        self.created = False

    def execute(self, statement, _params):
        assert "insert into public.wallet_transactions" in str(statement).lower()
        if self.created:
            return Result(None)
        self.created = True
        return Result({"id": "wallet-entry"})


def test_refund_credit_is_idempotent_for_same_reservation() -> None:
    session = RefundSession()
    reservation = {
        "id": "reservation-id",
        "user_id": PLAYER.id,
        "payment_id": PAYMENT_ID,
        "booking_amount_paid": Decimal("5.00"),
    }

    assert payment_repository.credit_reservation_payment(session, reservation, "Arena recusou")
    assert not payment_repository.credit_reservation_payment(session, reservation, "Retry")


def test_owner_and_player_cancellations_credit_inside_database_transaction() -> None:
    owner_source = inspect.getsource(owner_repository.update_reservation_status)
    player_source = inspect.getsource(booking_repository.cancel_player_reservation)
    assert "credit_reservation_payment(session" in owner_source
    assert "credit_reservation_payment(session" in player_source
    assert "with session_factory.begin()" in owner_source
    assert "with session_factory.begin()" in player_source


def test_refund_email_mentions_playarena_balance() -> None:
    reservation = ReservationEmailData(
        reservation_id="reservation-id",
        recipient_email="player@example.com",
        arena_name="Boleiros",
        court_name="Campo 1",
        sport_name="Society",
        start_at=START_AT,
        end_at=START_AT + timedelta(hours=1),
        price=Decimal("115.00"),
        booking_amount_paid=Decimal("5.00"),
        amount_due_at_venue=Decimal("110.00"),
        credited_to_wallet=True,
    )
    message = render_reservation_email(reservation, "rejected", "https://useplayarena.com.br")
    assert "R$ 5,00 voltaram para o seu Saldo PlayArena" in message.text


def test_payment_migration_has_financial_invariants_rls_and_immutable_ledger() -> None:
    migration = Path(__file__).parents[3] / "supabase" / "migrations" / "202609240001_payments_wallet_and_holds.sql"
    sql = migration.read_text(encoding="utf-8").lower()
    required = (
        "create table public.booking_holds",
        "booking_holds_no_overlap_active",
        "create table public.payments",
        "create table public.wallet_transactions",
        "wallet_transactions_one_refund_per_reservation",
        "prevent_wallet_transaction_update",
        "ensure_wallet_nonnegative",
        "wallet balance cannot be negative",
        "payments_select_own",
        "wallet_transactions_select_own",
        "revoke all on public.payment_webhook_events from authenticated",
        "reservations_financial_split",
        "court_price_total = booking_amount_paid + amount_due_at_venue",
    )
    assert all(item in sql for item in required)
    assert "profiles.wallet_balance" not in sql


def test_mixed_payment_migration_has_split_invariants() -> None:
    migration = (
        Path(__file__).parents[3]
        / "supabase"
        / "migrations"
        / "202609250001_mixed_wallet_provider_payments.sql"
    )
    sql = migration.read_text(encoding="utf-8").lower()

    assert "amount = wallet_amount + provider_amount" in sql
    assert "payments_provider_consistent" in sql
    assert "drop index if exists public.wallet_transactions_one_credit_per_payment" in sql
    assert "use_wallet_balance" in sql


def test_hold_expiration_and_availability_are_consistent() -> None:
    available_source = inspect.getsource(booking_repository.available)
    schedule_source = inspect.getsource(booking_repository.public_arena_schedule)
    expire_source = inspect.getsource(payment_repository.expire_stale_holds)
    assert "public.booking_holds" in available_source
    assert "h.expires_at > timezone('utc', now())" in available_source
    assert "public.booking_holds" in schedule_source
    assert "status = 'expired'" in expire_source
    assert "update public.payments" in expire_source
