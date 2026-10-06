from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from threading import Lock
from uuid import UUID

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

from app.api.routes import booking, payments
from app.core.config import Settings
from app.repositories import booking_repository, owner_repository, payment_repository
from app.schemas.auth import AuthenticatedUser
from app.schemas.booking import PlayerReservationCreate
from app.schemas.payment import CheckoutCreate
from app.services.notifications.templates import ReservationEmailData, render_reservation_email
from app.services.payments import service

PLAYER = AuthenticatedUser(id="00000000-0000-0000-0000-00000000000a", email="player@example.com")
COURT = UUID("20000000-0000-0000-0000-000000000001")
RESERVATION = UUID("50000000-0000-0000-0000-000000000001")
START = datetime.now(timezone.utc) + timedelta(days=3)


def request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("127.0.0.1", 12345)})


def booking_data() -> dict:
    return {
        "court_id": COURT, "start_at": START, "sport": "Society",
        "arena_id": UUID("10000000-0000-0000-0000-000000000001"),
        "arena_name": "Arena", "logo_path": None, "court_name": "Campo 1", "sport_name": "Society",
        "sport_id": UUID("30000000-0000-0000-0000-000000000001"),
        "customer_name": "Jogador", "customer_phone": "11999999999",
        "end_at": START + timedelta(hours=1), "court_price_total": Decimal("115.00"),
    }


class Row:
    def __init__(self, value):
        self.value = value

    def mappings(self):
        return self

    def one_or_none(self):
        return self.value

    def one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


class FreeSession:
    def __init__(self):
        self.sql = []
        self.params = []
        self.created = None

    def execute(self, statement, params=None):
        sql = str(statement).lower()
        self.sql.append(sql)
        self.params.append(params)
        if "select default_duration_minutes" in sql:
            return Row(60)
        if "pg_advisory_xact_lock" in sql:
            return Row(None)
        if "from public.reservations r" in sql:
            return Row(self.created)
        if "insert into public.reservations" in sql:
            self.created = {
                "id": RESERVATION, "start_at": START, "end_at": START + timedelta(hours=1),
                "court_price_total": params["court_price_total"],
                "booking_amount_paid": Decimal(str(params["booking_amount"])),
                "booking_amount": Decimal(str(params["booking_amount"])),
                "amount_due_at_venue": params["amount_due_at_venue"], "currency": params["currency"],
                "status": "pending", "arena_id": params["arena_id"], "arena_name": "Arena",
                "logo_path": None, "court_id": params["court_id"], "court_name": "Campo 1",
                "sport_name": "Society",
            }
            return Row(self.created)
        raise AssertionError(sql)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def begin(self):
        return self


def test_default_is_paid_and_flag_can_be_disabled() -> None:
    assert Settings(_env_file=None, BOOKING_PAYMENT_ENABLED=True).booking_payment_enabled
    assert not Settings(_env_file=None, BOOKING_PAYMENT_ENABLED=False).booking_payment_enabled


def test_free_quote_skips_wallet_and_advance_check(monkeypatch) -> None:
    session = FreeSession()
    monkeypatch.setattr(payment_repository, "get_session_factory", lambda: lambda: session)
    monkeypatch.setattr(payment_repository, "resolve_booking", lambda *_args, **_kwargs: booking_data())

    result = payment_repository.get_checkout_quote(PLAYER.id, COURT, START, "Society", Decimal("500.00"), payment_required=False)

    assert result["payment_required"] is False
    assert result["booking_amount"] == Decimal("0.00")
    assert result["amount_due_at_venue"] == Decimal("115.00")
    assert session.sql == []


def test_free_reservation_is_atomic_unpaid_and_slot_idempotent(monkeypatch) -> None:
    session = FreeSession()
    monkeypatch.setattr(booking_repository.settings, "booking_payment_enabled", False)
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: session)
    resolved = []
    monkeypatch.setattr(booking_repository, "resolve_booking", lambda *_args, **_kwargs: resolved.append(True) or booking_data())
    payload = {"court_id": COURT, "start_at": START, "sport": "Society"}

    first = booking_repository.create_player_reservation(PLAYER.id, payload)
    second = booking_repository.create_player_reservation(PLAYER.id, payload)

    assert first["reservation_id"] == second["reservation_id"] == RESERVATION
    assert first["booking_amount"] == Decimal("0.00")
    assert first["amount_due_at_venue"] == first["court_price_total"] == Decimal("115.00")
    assert first["currency"] == "BRL" and first["status"] == "pending"
    assert len(resolved) == 1
    assert sum("insert into public.reservations" in sql for sql in session.sql) == 1
    assert not any("insert into public.payments" in sql or "insert into public.booking_holds" in sql or "wallet_transactions" in sql for sql in session.sql)
    insert_params = next(params for sql, params in zip(session.sql, session.params) if "insert into public.reservations" in sql)
    assert insert_params["payment_id"] is None


def test_concurrent_free_requests_share_one_slot_reservation(monkeypatch) -> None:
    class SharedSlot:
        def __init__(self):
            self.lock = Lock()
            self.created = None
            self.inserts = 0

    class ConcurrentSession(FreeSession):
        def __init__(self, shared):
            super().__init__()
            self.shared = shared
            self.locked = False

        def __exit__(self, *_args):
            if self.locked:
                self.shared.lock.release()
            return False

        def execute(self, statement, params=None):
            sql = str(statement).lower()
            if "pg_advisory_xact_lock" in sql:
                self.shared.lock.acquire()
                self.locked = True
                return Row(None)
            if "from public.reservations r" in sql:
                return Row(self.shared.created)
            if "insert into public.reservations" in sql:
                assert self.shared.created is None
                result = super().execute(statement, params)
                self.shared.created = self.created
                self.shared.inserts += 1
                return result
            return super().execute(statement, params)

    class ConcurrentFactory:
        def __init__(self, shared):
            self.shared = shared

        def begin(self):
            return ConcurrentSession(self.shared)

    shared = SharedSlot()
    monkeypatch.setattr(booking_repository.settings, "booking_payment_enabled", False)
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: ConcurrentFactory(shared))
    monkeypatch.setattr(booking_repository, "resolve_booking", lambda *_args, **_kwargs: booking_data())
    payload = {"court_id": COURT, "start_at": START, "sport": "Society"}

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: booking_repository.create_player_reservation(PLAYER.id, payload), range(2)))

    assert shared.inserts == 1
    assert results[0]["reservation_id"] == results[1]["reservation_id"] == RESERVATION


def test_free_route_uses_server_flag_and_paid_route_remains_blocked(monkeypatch) -> None:
    monkeypatch.setattr(booking, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    called = []
    monkeypatch.setattr(booking, "create_player_reservation", lambda user_id, data: called.append((user_id, data)) or {"status": "pending"})
    payload = PlayerReservationCreate(court_id=COURT, start_at=START, sport="Society")
    monkeypatch.setattr(booking.settings, "booking_payment_enabled", False)
    assert booking.post_player_reservation(request(), BackgroundTasks(), payload, PLAYER)["status"] == "pending"
    assert called[0][0] == PLAYER.id
    monkeypatch.setattr(booking.settings, "booking_payment_enabled", True)
    with pytest.raises(HTTPException) as error:
        booking.post_player_reservation(request(), BackgroundTasks(), payload, PLAYER)
    assert error.value.detail["code"] == "payment_required"
    assert len(called) == 1


def test_free_route_queues_owner_email_only_for_new_reservation(monkeypatch) -> None:
    monkeypatch.setattr(booking.settings, "booking_payment_enabled", False)
    monkeypatch.setattr(booking, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    responses = iter([
        {"reservation_id": RESERVATION, "status": "pending", "_created_new": True},
        {"reservation_id": RESERVATION, "status": "pending"},
    ])
    monkeypatch.setattr(booking, "create_player_reservation", lambda *_args: next(responses))
    payload = PlayerReservationCreate(court_id=COURT, start_at=START, sport="Society")

    first_tasks = BackgroundTasks()
    first = booking.post_player_reservation(request(), first_tasks, payload, PLAYER)
    second_tasks = BackgroundTasks()
    second = booking.post_player_reservation(request(), second_tasks, payload, PLAYER)

    assert first == second == {"reservation_id": RESERVATION, "status": "pending"}
    assert len(first_tasks.tasks) == 1
    assert first_tasks.tasks[0].args == (RESERVATION,)
    assert second_tasks.tasks == []


def test_checkout_and_provider_cannot_start_while_free(monkeypatch) -> None:
    monkeypatch.setattr(payments.settings, "booking_payment_enabled", False)
    monkeypatch.setattr(payments, "create_checkout", lambda *_args, **_kwargs: pytest.fail("checkout called"))
    monkeypatch.setattr(service, "create_checkout_record", lambda **_kwargs: pytest.fail("hold created"))
    payload = CheckoutCreate(court_id=COURT, start_at=START, sport="Society", payment_method="provider", idempotency_key="checkout_1234567890abcdef")
    with pytest.raises(HTTPException) as error:
        payments.post_checkout(request(), BackgroundTasks(), payload, PLAYER)
    assert error.value.detail["code"] == "booking_payment_disabled"
    with pytest.raises(service.PaymentConfigurationError):
        service.create_checkout(PLAYER.id, payload.model_dump(), payer_email=PLAYER.email)


def test_paid_checkout_route_is_available_again_when_flag_is_true(monkeypatch) -> None:
    monkeypatch.setattr(payments.settings, "booking_payment_enabled", True)
    monkeypatch.setattr(payments, "enforce_rate_limit", lambda *_args, **_kwargs: None)
    called = []
    monkeypatch.setattr(payments, "create_checkout", lambda user_id, data, payer_email=None, **_kwargs: called.append((user_id, data, payer_email)) or {"status": "pending"})
    payload = CheckoutCreate(court_id=COURT, start_at=START, sport="Society", payment_method="provider", idempotency_key="checkout_1234567890abcdef")
    assert payments.post_checkout(request(), BackgroundTasks(), payload, PLAYER) == {"status": "pending"}
    assert called[0][0] == PLAYER.id and called[0][2] == PLAYER.email


def test_quote_route_exposes_server_owned_payment_mode(monkeypatch) -> None:
    monkeypatch.setattr(payments, "get_checkout_quote", lambda *_args, **kwargs: {
        "requires_provider": False, "payment_required": kwargs.get("payment_required", True),
    })
    monkeypatch.setattr(payments.settings, "booking_payment_enabled", False)
    free = payments.checkout_quote(COURT, START, "Society", False, PLAYER)
    assert free["payment_required"] is False
    assert free["provider_available"] is False and free["checkout_available"] is True
    monkeypatch.setattr(payments.settings, "booking_payment_enabled", True)
    paid = payments.checkout_quote(COURT, START, "Society", False, PLAYER)
    assert paid["payment_required"] is True


def test_free_cancellation_never_credits_and_paid_history_still_does(monkeypatch) -> None:
    class WalletSession:
        def __init__(self):
            self.writes = []

        def execute(self, statement, params):
            self.writes.append((str(statement), params))
            return Row({"id": "credit-id"})

    session = WalletSession()
    free = {"id": RESERVATION, "user_id": PLAYER.id, "payment_id": None, "booking_amount_paid": Decimal("0.00")}
    paid = {**free, "payment_id": UUID("60000000-0000-0000-0000-000000000001"), "booking_amount_paid": Decimal("5.00")}
    monkeypatch.setattr(booking_repository.settings, "booking_payment_enabled", False)
    for reason in ("Arena recusou", "Arena cancelou", "Player cancelou"):
        assert not payment_repository.credit_reservation_payment(session, free, reason)
    assert session.writes == []
    assert payment_repository.credit_reservation_payment(session, paid, "Reserva antiga cancelada")
    assert session.writes[0][1]["amount"] == Decimal("5.00")


def test_player_cancels_free_reservation_without_wallet_write(monkeypatch) -> None:
    class CancelSession:
        def __init__(self):
            self.sql = []

        def begin(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, _params):
            sql = str(statement).lower()
            self.sql.append(sql)
            if "select id, status, start_at" in sql:
                return Row({"id": RESERVATION, "status": "pending", "start_at": START,
                            "user_id": PLAYER.id, "payment_id": None, "booking_amount_paid": Decimal("0.00")})
            if "update public.reservations" in sql:
                return Row({"id": RESERVATION, "status": "cancelled"})
            raise AssertionError(sql)

    session = CancelSession()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: session)
    result = booking_repository.cancel_player_reservation(PLAYER.id, RESERVATION, current_time=START - timedelta(hours=2))
    assert result["credited_to_wallet"] is False
    assert not any("wallet_transactions" in sql for sql in session.sql)


def test_free_notification_copy_has_no_refund_or_paid_amount() -> None:
    reservation = ReservationEmailData(
        reservation_id=str(RESERVATION), recipient_email=PLAYER.email, arena_name="Arena",
        court_name="Campo 1", sport_name="Society", start_at=START,
        end_at=START + timedelta(hours=1), price=Decimal("115.00"),
        booking_amount_paid=Decimal("0.00"), amount_due_at_venue=Decimal("115.00"),
    )
    for kind in ("confirmed", "rejected", "cancelled"):
        message = render_reservation_email(reservation, kind, "https://example.com")
        assert "Saldo PlayArena" not in message.text
        assert "Pago no PlayArena" not in message.text


def test_owner_reject_and_cancel_free_reservations_without_wallet_credit(monkeypatch) -> None:
    class OwnerSession:
        def begin(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, params):
            assert "update public.reservations" in str(statement).lower()
            return Row({"id": RESERVATION, "status": "cancelled"})

    session = OwnerSession()
    monkeypatch.setattr(owner_repository, "get_session_factory", lambda: session)
    for current in ("pending", "confirmed"):
        monkeypatch.setattr(owner_repository, "_owned_reservation", lambda *_args: {
            "id": RESERVATION, "user_id": PLAYER.id, "status": current,
            "payment_id": None, "booking_amount_paid": Decimal("0.00"),
        })
        result = owner_repository.update_reservation_status(PLAYER.id, RESERVATION, "cancelled")
        assert result["credited_to_wallet"] is False
