from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.session import get_session_factory
from app.services.payments.providers import ProviderWebhookEvent

logger = logging.getLogger(__name__)
MONEY = Decimal("0.01")


class CheckoutNotFoundError(Exception):
    pass


class CheckoutSlotUnavailableError(Exception):
    pass


class CheckoutConfigurationError(Exception):
    pass


class WalletInsufficientBalanceError(Exception):
    pass


class CheckoutIdempotencyConflictError(Exception):
    pass


class CheckoutPaymentPlanChangedError(Exception):
    pass


class PaymentOwnershipError(Exception):
    pass


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(MONEY)


def split_checkout_amounts(
    wallet_balance: Decimal,
    advance_amount: Decimal,
    *,
    use_wallet_balance: bool,
) -> tuple[Decimal, Decimal]:
    advance = _decimal(advance_amount)
    available = max(_decimal(wallet_balance), Decimal("0.00"))
    wallet_amount = min(available, advance) if use_wallet_balance else Decimal("0.00")
    return wallet_amount, advance - wallet_amount


def _lock_slot(session: Any, court_id: UUID | str, start_at: datetime, end_at: datetime) -> None:
    key = f"{court_id}:{start_at.isoformat()}:{end_at.isoformat()}"
    session.execute(text("select pg_advisory_xact_lock(hashtextextended(:slot_key, 0))"), {"slot_key": key})


def lock_booking_slot(session: Any, court_id: UUID | str, start_at: datetime, end_at: datetime) -> None:
    _lock_slot(session, court_id, start_at, end_at)


def expire_stale_holds(session: Any) -> None:
    session.execute(text("""
        update public.booking_holds
        set status = 'expired'
        where status = 'active' and expires_at <= timezone('utc', now())
    """))
    session.execute(text("""
        with expired_payments as (
          update public.payments p
          set status = 'expired'
          from public.booking_holds h
          where p.hold_id = h.id and p.status = 'pending' and h.status = 'expired'
          returning p.id, p.user_id, p.wallet_amount
        )
        insert into public.wallet_transactions
          (user_id, type, amount, payment_id, reason, idempotency_key)
        select user_id, 'refund_credit', wallet_amount, id,
               'Saldo reservado devolvido apos expiracao',
               'checkout-wallet-release:' || id::text
        from expired_payments
        where wallet_amount > 0
        on conflict do nothing
    """))


def _wallet_balance(session: Any, user_id: str) -> Decimal:
    value = session.execute(text("""
        select coalesce(sum(amount), 0)
        from public.wallet_transactions
        where user_id = :user_id and currency = 'BRL'
    """), {"user_id": user_id}).scalar_one()
    return _decimal(value)


def _resolve_booking(
    session: Any,
    *,
    user_id: str,
    court_id: UUID,
    start_at: datetime,
    sport: str,
) -> dict[str, Any]:
    booking = session.execute(text("""
        select c.id as court_id, c.name as court_name, c.arena_id,
               c.default_duration_minutes as duration_minutes,
               a.name as arena_name, a.logo_path,
               s.id as sport_id, s.name as sport_name,
               p.full_name as customer_name, p.phone as customer_phone
        from public.courts c
        join public.arenas a on a.id = c.arena_id
        join public.court_sports cs on cs.court_id = c.id
        join public.sports s on s.id = cs.sport_id
        join public.profiles p on p.id = :user_id
        where c.id = :court_id and c.active and a.active
          and (lower(s.name) = lower(:sport) or lower(s.slug) = lower(:sport))
        limit 1
    """), {"user_id": user_id, "court_id": court_id, "sport": sport}).mappings().one_or_none()
    if booking is None:
        raise CheckoutNotFoundError
    result = dict(booking)
    if not result.get("customer_name") or not result.get("customer_phone"):
        raise CheckoutConfigurationError("Complete seu perfil antes de continuar.")

    end_at = start_at + timedelta(minutes=int(result["duration_minutes"]))
    slot = session.execute(text("""
        select
          exists (
            select 1 from public.opening_hours oh
            where oh.arena_id = :arena_id and oh.active
              and oh.weekday = extract(dow from cast(:start_at as timestamptz) at time zone 'America/Sao_Paulo')::smallint
              and oh.open_time <= (cast(:start_at as timestamptz) at time zone 'America/Sao_Paulo')::time
              and oh.close_time >= (cast(:end_at as timestamptz) at time zone 'America/Sao_Paulo')::time
          ) as is_open,
          exists (
            select 1 from public.blocked_slots b where b.court_id = :court_id
              and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(:start_at, :end_at, '[)')
          ) as is_blocked,
          exists (
            select 1 from public.reservations r where r.court_id = :court_id
              and r.status in ('pending', 'confirmed')
              and r.reservation_window && tstzrange(:start_at, :end_at, '[)')
          ) as is_reserved,
          exists (
            select 1 from public.booking_holds h where h.court_id = :court_id
              and h.status = 'active' and h.expires_at > timezone('utc', now())
              and h.hold_window && tstzrange(:start_at, :end_at, '[)')
          ) as is_held,
          (
            select pr.price from public.pricing_rules pr
            where pr.court_id = :court_id and pr.active
              and pr.weekday = extract(dow from cast(:start_at as timestamptz) at time zone 'America/Sao_Paulo')::smallint
              and pr.start_time <= (cast(:start_at as timestamptz) at time zone 'America/Sao_Paulo')::time
              and pr.end_time >= (cast(:end_at as timestamptz) at time zone 'America/Sao_Paulo')::time
            order by (pr.end_time - pr.start_time), pr.created_at desc, pr.id desc limit 1
          ) as price
    """), {"arena_id": result["arena_id"], "court_id": court_id, "start_at": start_at, "end_at": end_at}).mappings().one()
    if not slot["is_open"] or slot["is_blocked"] or slot["is_reserved"] or slot["is_held"] or slot["price"] is None:
        raise CheckoutSlotUnavailableError
    result.update(end_at=end_at, court_price_total=_decimal(slot["price"]))
    return result


def get_checkout_quote(
    user_id: str,
    court_id: UUID,
    start_at: datetime,
    sport: str,
    advance_amount: Decimal,
    *,
    use_wallet_balance: bool = False,
) -> dict[str, Any]:
    factory = get_session_factory()
    with factory() as session:
        booking = _resolve_booking(session, user_id=user_id, court_id=court_id, start_at=start_at, sport=sport)
        advance = _decimal(advance_amount)
        if booking["court_price_total"] < advance:
            raise CheckoutConfigurationError("O valor do campo e menor que a antecipacao configurada.")
        balance = _wallet_balance(session, user_id)
        wallet_amount, provider_amount = split_checkout_amounts(
            balance,
            advance,
            use_wallet_balance=use_wallet_balance,
        )
        return {
            **booking,
            "start_at": start_at,
            "booking_amount": advance,
            "amount_due_at_venue": booking["court_price_total"] - advance,
            "currency": "BRL",
            "wallet_balance": balance,
            "wallet_available": balance >= advance,
            "wallet_has_balance": balance > 0,
            "use_wallet_balance": use_wallet_balance,
            "wallet_amount": wallet_amount,
            "provider_amount": provider_amount,
            "requires_provider": provider_amount > 0,
        }


def _payment_response(payment: dict[str, Any], booking: dict[str, Any] | None = None) -> dict[str, Any]:
    response = dict(payment)
    if booking:
        response.update({
            key: booking[key]
            for key in (
                "arena_id", "arena_name", "logo_path", "court_id", "court_name", "sport_id", "sport_name",
                "start_at", "end_at", "court_price_total", "booking_amount", "amount_due_at_venue", "currency",
            )
            if key in booking
        })
    return response


def _existing_checkout(session: Any, user_id: str, idempotency_key: str) -> dict[str, Any] | None:
    row = session.execute(text("""
        select p.id as payment_id, p.hold_id, p.reservation_id, p.provider, p.provider_payment_id,
               p.amount, p.wallet_amount, p.provider_amount, p.use_wallet_balance,
               p.currency, p.status, p.checkout_url, p.expires_at,
               h.arena_id, a.name as arena_name, a.logo_path, h.court_id, c.name as court_name,
               h.sport_id, s.name as sport_name, h.start_at, h.end_at,
               h.court_price_total, h.booking_amount, h.amount_due_at_venue
        from public.payments p
        join public.booking_holds h on h.id = p.hold_id
        join public.arenas a on a.id = h.arena_id
        join public.courts c on c.id = h.court_id
        left join public.sports s on s.id = h.sport_id
        where p.user_id = :user_id and p.idempotency_key = :idempotency_key
    """), {"user_id": user_id, "idempotency_key": idempotency_key}).mappings().one_or_none()
    return dict(row) if row else None


def _insert_reservation(session: Any, *, hold: dict[str, Any], payment_id: UUID | str) -> dict[str, Any]:
    return dict(session.execute(text("""
        insert into public.reservations (
          arena_id, court_id, user_id, customer_name, customer_phone, start_at, end_at,
          price, status, source, sport_id, court_price_total, booking_amount_paid,
          amount_due_at_venue, currency, payment_id
        ) values (
          :arena_id, :court_id, :user_id, :customer_name, :customer_phone, :start_at, :end_at,
          :court_price_total, 'pending', 'app', :sport_id, :court_price_total, :booking_amount,
          :amount_due_at_venue, :currency, :payment_id
        )
        returning id, start_at, end_at, price, court_price_total, booking_amount_paid,
                  amount_due_at_venue, currency, status, source
    """), {**hold, "payment_id": payment_id}).mappings().one())


def create_checkout_record(
    *,
    user_id: str,
    court_id: UUID,
    start_at: datetime,
    sport: str,
    payment_method: str,
    idempotency_key: str,
    advance_amount: Decimal,
    hold_minutes: int,
    provider_name: str | None,
    use_wallet_balance: bool = False,
    quoted_wallet_amount: Decimal | None = None,
    quoted_provider_amount: Decimal | None = None,
) -> tuple[dict[str, Any], bool]:
    factory = get_session_factory()
    try:
        with factory.begin() as session:
            expire_stale_holds(session)
            existing = _existing_checkout(session, user_id, idempotency_key)
            wallet_requested = payment_method == "wallet" or use_wallet_balance
            if existing:
                if (
                    existing["court_id"] != court_id
                    or existing["start_at"] != start_at
                    or bool(existing["use_wallet_balance"]) != wallet_requested
                    or (payment_method == "wallet" and existing["provider"] != "wallet")
                ):
                    raise CheckoutIdempotencyConflictError
                return existing, False

            base = _resolve_booking(session, user_id=user_id, court_id=court_id, start_at=start_at, sport=sport)
            _lock_slot(session, court_id, start_at, base["end_at"])
            # Re-read after acquiring the shared slot lock to close checkout races.
            base = _resolve_booking(session, user_id=user_id, court_id=court_id, start_at=start_at, sport=sport)
            advance = _decimal(advance_amount)
            total = base["court_price_total"]
            if total < advance:
                raise CheckoutConfigurationError("O valor do campo e menor que a antecipacao configurada.")
            if wallet_requested:
                session.execute(
                    text("select id from public.profiles where id = :user_id for update"),
                    {"user_id": user_id},
                )
            balance = _wallet_balance(session, user_id) if wallet_requested else Decimal("0.00")
            wallet_amount, provider_amount = split_checkout_amounts(
                balance,
                advance,
                use_wallet_balance=wallet_requested,
            )
            if (
                quoted_wallet_amount is not None
                and _decimal(quoted_wallet_amount) != wallet_amount
            ) or (
                quoted_provider_amount is not None
                and _decimal(quoted_provider_amount) != provider_amount
            ):
                raise CheckoutPaymentPlanChangedError
            if payment_method == "wallet" and wallet_amount < advance:
                raise WalletInsufficientBalanceError
            if provider_amount > 0 and provider_name not in {"sandbox", "mercado_pago"}:
                raise CheckoutConfigurationError("O pagamento via PIX ainda nao esta disponivel.")

            expires_at = datetime.now(timezone.utc) + timedelta(minutes=hold_minutes)
            hold_values = {
                **base,
                "user_id": user_id,
                "start_at": start_at,
                "booking_amount": advance,
                "amount_due_at_venue": total - advance,
                "currency": "BRL",
                "idempotency_key": idempotency_key,
                "expires_at": expires_at,
            }
            hold = dict(session.execute(text("""
                insert into public.booking_holds (
                  user_id, arena_id, court_id, sport_id, customer_name, customer_phone,
                  start_at, end_at, court_price_total, booking_amount, amount_due_at_venue,
                  currency, idempotency_key, expires_at
                ) values (
                  :user_id, :arena_id, :court_id, :sport_id, :customer_name, :customer_phone,
                  :start_at, :end_at, :court_price_total, :booking_amount, :amount_due_at_venue,
                  :currency, :idempotency_key, :expires_at
                ) returning id
            """), hold_values).mappings().one())
            provider = "wallet" if provider_amount == 0 else provider_name
            payment_status = "paid" if provider_amount == 0 else "pending"

            payment = dict(session.execute(text("""
                insert into public.payments (
                  hold_id, user_id, provider, amount, wallet_amount, provider_amount,
                  use_wallet_balance, currency, status, idempotency_key, paid_at, expires_at
                ) values (
                  :hold_id, :user_id, :provider, :amount, :wallet_amount, :provider_amount,
                  :use_wallet_balance, 'BRL', :status, :idempotency_key,
                  case when :status = 'paid' then timezone('utc', now()) else null end,
                  :expires_at
                ) returning id as payment_id, hold_id, reservation_id, provider,
                            provider_payment_id, amount, wallet_amount, provider_amount,
                            use_wallet_balance, currency, status, checkout_url, expires_at
            """), {
                "hold_id": hold["id"], "user_id": user_id, "provider": provider,
                "amount": advance, "wallet_amount": wallet_amount,
                "provider_amount": provider_amount, "use_wallet_balance": wallet_requested,
                "status": payment_status, "idempotency_key": idempotency_key,
                "expires_at": expires_at,
            }).mappings().one())

            if wallet_amount > 0:
                session.execute(text("""
                    insert into public.wallet_transactions
                      (user_id, type, amount, payment_id, reason, idempotency_key)
                    values (:user_id, 'booking_debit', :amount, :payment_id,
                            'Utilizado em reserva', :ledger_key)
                """), {
                    "user_id": user_id, "amount": -wallet_amount,
                    "payment_id": payment["payment_id"],
                    "ledger_key": f"booking-debit:{payment['payment_id']}",
                })

            if provider_amount == 0:
                reservation = _insert_reservation(session, hold=hold_values, payment_id=payment["payment_id"])
                session.execute(text("""
                    update public.payments set reservation_id = :reservation_id where id = :payment_id
                """), {"reservation_id": reservation["id"], "payment_id": payment["payment_id"]})
                session.execute(text("""
                    update public.booking_holds set status = 'converted', reservation_id = :reservation_id where id = :hold_id
                """), {"reservation_id": reservation["id"], "hold_id": hold["id"]})
                payment["reservation_id"] = reservation["id"]
            if wallet_amount > 0:
                logger.info("wallet.debit payment_id=%s", payment["payment_id"])
            logger.info("payment.created payment_id=%s provider=%s", payment["payment_id"], provider)
            return _payment_response(payment, hold_values), True
    except IntegrityError as exc:
        raise CheckoutSlotUnavailableError from exc


def attach_provider_payment(payment_id: UUID | str, provider_payment_id: str, checkout_url: str | None) -> dict[str, Any]:
    factory = get_session_factory()
    with factory.begin() as session:
        row = session.execute(text("""
            update public.payments
            set provider_payment_id = coalesce(provider_payment_id, :provider_payment_id),
                checkout_url = coalesce(checkout_url, :checkout_url)
            where id = :payment_id and status = 'pending'
              and (provider_payment_id is null or provider_payment_id = :provider_payment_id)
            returning id as payment_id, hold_id, reservation_id, provider, provider_payment_id,
                      amount, wallet_amount, provider_amount, use_wallet_balance,
                      currency, status, checkout_url, expires_at
        """), {"payment_id": payment_id, "provider_payment_id": provider_payment_id, "checkout_url": checkout_url}).mappings().one_or_none()
        if row is None:
            raise CheckoutNotFoundError
        return dict(row)


def _credit_payment_amount(
    session: Any,
    payment: dict[str, Any],
    *,
    amount: Decimal,
    reason: str,
    ledger_key: str,
) -> bool:
    if amount <= 0:
        return False
    row = session.execute(text("""
        insert into public.wallet_transactions
          (user_id, type, amount, payment_id, reason, idempotency_key)
        values (:user_id, 'refund_credit', :amount, :payment_id, :reason, :idempotency_key)
        on conflict do nothing
        returning id
    """), {
        "user_id": payment["user_id"],
        "amount": amount,
        "payment_id": payment["payment_id"],
        "reason": reason,
        "idempotency_key": ledger_key,
    }).mappings().one_or_none()
    return row is not None


def _release_wallet_contribution(session: Any, payment: dict[str, Any], reason: str) -> bool:
    return _credit_payment_amount(
        session,
        payment,
        amount=_decimal(payment.get("wallet_amount", 0)),
        reason=reason,
        ledger_key=f"checkout-wallet-release:{payment['payment_id']}",
    )


def fail_checkout_payment(payment_id: UUID | str, failure_code: str) -> None:
    factory = get_session_factory()
    with factory.begin() as session:
        row = session.execute(text("""
            update public.payments set status = 'failed', failed_at = timezone('utc', now()), failure_code = :failure_code
            where id = :payment_id and status = 'pending'
            returning id as payment_id, hold_id, user_id, wallet_amount
        """), {"payment_id": payment_id, "failure_code": failure_code}).mappings().one_or_none()
        if row:
            session.execute(text("update public.booking_holds set status = 'cancelled' where id = :hold_id and status = 'active'"), {"hold_id": row["hold_id"]})
            _release_wallet_contribution(
                session,
                dict(row),
                "Saldo reservado devolvido por falha no pagamento",
            )
            logger.info("payment.failed payment_id=%s", payment_id)


def get_player_payment(user_id: str, payment_id: UUID) -> dict[str, Any]:
    factory = get_session_factory()
    with factory.begin() as session:
        expire_stale_holds(session)
        row = session.execute(text("""
            select p.id as payment_id, p.hold_id, p.reservation_id, p.provider, p.provider_payment_id,
                   p.amount, p.wallet_amount, p.provider_amount, p.use_wallet_balance, p.currency,
                   case when p.status = 'pending' and h.status = 'expired' then 'expired' else p.status end as status,
                   p.checkout_url, p.expires_at, h.arena_id, a.name as arena_name, a.logo_path,
                   h.court_id, c.name as court_name, h.sport_id, s.name as sport_name,
                   h.start_at, h.end_at, h.court_price_total, h.booking_amount, h.amount_due_at_venue
            from public.payments p join public.booking_holds h on h.id = p.hold_id
            join public.arenas a on a.id = h.arena_id join public.courts c on c.id = h.court_id
            left join public.sports s on s.id = h.sport_id
            where p.id = :payment_id and p.user_id = :user_id
        """), {"payment_id": payment_id, "user_id": user_id}).mappings().one_or_none()
        if row is None:
            raise PaymentOwnershipError
        if row["status"] == "expired":
            session.execute(text("""
                update public.payments set status = 'expired'
                where id = :payment_id and status = 'pending'
            """), {"payment_id": payment_id})
        return dict(row)


def _credit_unfulfilled_payment(session: Any, payment: dict[str, Any], reason: str) -> None:
    _release_wallet_contribution(session, payment, reason)
    _credit_payment_amount(
        session,
        payment,
        amount=_decimal(payment.get("provider_amount", payment["amount"])),
        reason=reason,
        ledger_key=f"unfulfilled-provider-credit:{payment['payment_id']}",
    )


def process_provider_event(provider: str, event: ProviderWebhookEvent, raw_payload: bytes) -> dict[str, Any]:
    factory = get_session_factory()
    payload_hash = hashlib.sha256(raw_payload).hexdigest()
    with factory.begin() as session:
        event_row = session.execute(text("""
            insert into public.payment_webhook_events
              (provider, provider_event_id, payload_sha256, result)
            values (:provider, :event_id, :payload_hash, 'ignored')
            on conflict (provider, provider_event_id) do nothing
            returning id
        """), {"provider": provider, "event_id": event.event_id, "payload_hash": payload_hash}).mappings().one_or_none()
        if event_row is None:
            return {"result": "duplicate"}

        payment_row = session.execute(text("""
            select p.id as payment_id, p.user_id, p.hold_id, p.reservation_id,
                   p.provider_payment_id, p.status, p.amount, p.wallet_amount,
                   p.provider_amount, p.use_wallet_balance, p.currency,
                   h.arena_id, h.court_id, h.sport_id, h.customer_name, h.customer_phone,
                   h.start_at, h.end_at, h.court_price_total, h.booking_amount,
                   h.amount_due_at_venue, h.status as hold_status,
                   h.expires_at <= timezone('utc', now()) as hold_expired
            from public.payments p join public.booking_holds h on h.id = p.hold_id
            where p.provider = :provider
              and (
                p.provider_payment_id = :provider_payment_id
                or (
                  p.provider_payment_id is null
                  and p.id::text = :external_reference
                )
              )
            for update of p, h
        """), {
            "provider": provider,
            "provider_payment_id": event.provider_payment_id,
            "external_reference": event.external_reference,
        }).mappings().one_or_none()
        if payment_row is None:
            session.execute(text("update public.payment_webhook_events set result='rejected', processed_at=timezone('utc', now()) where id=:id"), {"id": event_row["id"]})
            return {"result": "unknown_payment"}
        payment = dict(payment_row)
        if (
            _decimal(event.amount) != _decimal(payment["provider_amount"])
            or event.currency != payment["currency"]
        ):
            session.execute(text("update public.payment_webhook_events set payment_id=:payment_id, result='rejected', processed_at=timezone('utc', now()) where id=:id"), {"payment_id": payment["payment_id"], "id": event_row["id"]})
            return {"result": "amount_mismatch"}
        if event.external_reference is not None and event.external_reference != str(payment["payment_id"]):
            session.execute(text("update public.payment_webhook_events set payment_id=:payment_id, result='rejected', processed_at=timezone('utc', now()) where id=:id"), {"payment_id": payment["payment_id"], "id": event_row["id"]})
            return {"result": "external_reference_mismatch"}
        if payment.get("provider_payment_id") is None:
            session.execute(text("""
                update public.payments
                set provider_payment_id = :provider_payment_id
                where id = :payment_id and provider_payment_id is null
            """), {
                "provider_payment_id": event.provider_payment_id,
                "payment_id": payment["payment_id"],
            })
        late_paid = payment["status"] == "expired" and event.status == "paid"
        if payment["status"] != "pending" and not late_paid:
            session.execute(text("update public.payment_webhook_events set payment_id=:payment_id, result='ignored', processed_at=timezone('utc', now()) where id=:id"), {"payment_id": payment["payment_id"], "id": event_row["id"]})
            return {"result": "already_final", "status": payment["status"], "reservation_id": payment.get("reservation_id")}

        if event.status == "pending":
            session.execute(text("update public.payment_webhook_events set payment_id=:payment_id, result='processed', processed_at=timezone('utc', now()) where id=:id"), {"payment_id": payment["payment_id"], "id": event_row["id"]})
            return {"result": "processed", "status": "pending", "reservation_id": None}

        if event.status in {"failed", "cancelled"}:
            session.execute(text("""
                update public.payments
                set status=:status,
                    failed_at=case when :status='failed' then timezone('utc', now()) else failed_at end
                where id=:payment_id
            """), {"status": event.status, "payment_id": payment["payment_id"]})
            session.execute(text("update public.booking_holds set status='cancelled' where id=:hold_id and status='active'"), {"hold_id": payment["hold_id"]})
            _release_wallet_contribution(
                session,
                payment,
                "Saldo reservado devolvido por pagamento nao concluido",
            )
            session.execute(text("update public.payment_webhook_events set payment_id=:payment_id, result='processed', processed_at=timezone('utc', now()) where id=:id"), {"payment_id": payment["payment_id"], "id": event_row["id"]})
            logger.info("payment.%s payment_id=%s", event.status, payment["payment_id"])
            return {"result": "processed", "status": event.status, "reservation_id": None}

        _lock_slot(session, payment["court_id"], payment["start_at"], payment["end_at"])
        conflict = session.execute(text("""
            select exists(
              select 1 from public.reservations r where r.court_id=:court_id
                and r.status in ('pending','confirmed')
                and r.reservation_window && tstzrange(:start_at,:end_at,'[)')
              union all
              select 1 from public.blocked_slots b where b.court_id=:court_id
                and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(:start_at,:end_at,'[)')
            )
        """), {"court_id": payment["court_id"], "start_at": payment["start_at"], "end_at": payment["end_at"]}).scalar_one()
        session.execute(text("update public.payments set status='paid', paid_at=timezone('utc', now()) where id=:payment_id"), {"payment_id": payment["payment_id"]})
        if payment["hold_expired"] or payment["hold_status"] != "active" or conflict:
            next_hold = "expired" if payment["hold_expired"] else "cancelled"
            session.execute(text("update public.booking_holds set status=:status where id=:hold_id and status='active'"), {"status": next_hold, "hold_id": payment["hold_id"]})
            _credit_unfulfilled_payment(session, payment, "Pagamento confirmado sem reserva; credito protegido")
            session.execute(text("update public.payments set failure_code='slot_unavailable_credited' where id=:payment_id"), {"payment_id": payment["payment_id"]})
            reservation_id = None
            logger.info("wallet.credit payment_id=%s reason=unfulfilled-payment", payment["payment_id"])
        else:
            reservation = _insert_reservation(session, hold=payment, payment_id=payment["payment_id"])
            reservation_id = reservation["id"]
            session.execute(text("update public.payments set reservation_id=:reservation_id where id=:payment_id"), {"reservation_id": reservation_id, "payment_id": payment["payment_id"]})
            session.execute(text("update public.booking_holds set status='converted', reservation_id=:reservation_id where id=:hold_id"), {"reservation_id": reservation_id, "hold_id": payment["hold_id"]})
        session.execute(text("update public.payment_webhook_events set payment_id=:payment_id, result='processed', processed_at=timezone('utc', now()) where id=:id"), {"payment_id": payment["payment_id"], "id": event_row["id"]})
        logger.info("payment.paid payment_id=%s", payment["payment_id"])
        return {"result": "processed", "status": "paid", "reservation_id": reservation_id}


def credit_reservation_payment(session: Any, reservation: dict[str, Any], reason: str) -> bool:
    amount = _decimal(reservation.get("booking_amount_paid", 0))
    if amount <= 0 or not reservation.get("user_id"):
        return False
    row = session.execute(text("""
        insert into public.wallet_transactions
          (user_id, type, amount, reservation_id, payment_id, reason, idempotency_key)
        values (:user_id, 'refund_credit', :amount, :reservation_id, :payment_id, :reason, :idempotency_key)
        on conflict do nothing returning id
    """), {
        "user_id": reservation["user_id"], "amount": amount, "reservation_id": reservation["id"],
        "payment_id": reservation.get("payment_id"), "reason": reason,
        "idempotency_key": f"reservation-refund:{reservation['id']}",
    }).mappings().one_or_none()
    if row:
        logger.info("wallet.credit reservation_id=%s", reservation["id"])
    return row is not None


def get_wallet(user_id: str) -> dict[str, Any]:
    factory = get_session_factory()
    with factory() as session:
        balance = _wallet_balance(session, user_id)
        rows = session.execute(text("""
            select wt.id, wt.type, wt.amount, wt.currency, wt.reason, wt.created_at,
                   wt.reservation_id, coalesce(ar.name, ah.name) as arena_name
            from public.wallet_transactions wt
            left join public.reservations r on r.id = wt.reservation_id
            left join public.arenas ar on ar.id = r.arena_id
            left join public.payments p on p.id = wt.payment_id
            left join public.booking_holds h on h.id = p.hold_id
            left join public.arenas ah on ah.id = h.arena_id
            where wt.user_id = :user_id
            order by wt.created_at desc, wt.id desc
            limit 100
        """), {"user_id": user_id}).mappings()
        return {"balance": balance, "currency": "BRL", "transactions": [dict(row) for row in rows]}


def get_admin_payments(days: int, limit: int = 100) -> dict[str, Any]:
    factory = get_session_factory()
    with factory() as session:
        overview = dict(session.execute(text("""
            with filtered as (
              select * from public.payments where created_at >= timezone('utc', now()) - make_interval(days => :days)
            ) select count(*) as payments,
                     coalesce(sum(amount) filter (where status='paid'), 0) as paid_amount,
                     count(*) filter (where status='paid') as paid,
                     count(*) filter (where status='failed') as failed,
                     count(*) filter (where status='pending') as pending,
                     count(*) filter (where status='pending' and expires_at <= timezone('utc', now())) as pending_stale,
                     (select coalesce(sum(amount),0) from public.wallet_transactions
                       where type='refund_credit' and created_at >= timezone('utc', now()) - make_interval(days => :days)) as credits
              from filtered
        """), {"days": days}).mappings().one())
        rows = session.execute(text("""
            select p.id, p.provider, p.provider_payment_id, p.amount,
                   p.wallet_amount, p.provider_amount, p.currency, p.status,
                   p.reservation_id, p.failure_code, p.expires_at, p.created_at, p.paid_at,
                   a.id as arena_id, a.name as arena_name
            from public.payments p join public.booking_holds h on h.id=p.hold_id
            join public.arenas a on a.id=h.arena_id
            where p.created_at >= timezone('utc', now()) - make_interval(days => :days)
            order by p.created_at desc limit :limit
        """), {"days": days, "limit": limit}).mappings()
        reconciliation = dict(session.execute(text("""
            with credits as (
              select payment_id, sum(amount) as amount
              from public.wallet_transactions
              where type='refund_credit' and payment_id is not null
              group by payment_id
            )
            select
              count(*) filter (
                where p.status='paid' and p.reservation_id is null
                  and coalesce(cr.amount, 0) < p.amount
              ) as paid_without_reservation_or_credit,
              count(*) filter (where p.status='paid' and p.reservation_id is not null and r.id is null) as missing_reservation,
              count(*) filter (where r.id is not null and r.payment_id <> p.id) as mismatched_reservation_payment
            from public.payments p
            left join public.reservations r on r.id=p.reservation_id
            left join credits cr on cr.payment_id=p.id
        """)).mappings().one())
        return {"overview": overview, "payments": [dict(row) for row in rows], "reconciliation": reconciliation}


def get_admin_payment_for_reconciliation(payment_id: UUID) -> dict[str, Any]:
    factory = get_session_factory()
    with factory() as session:
        row = session.execute(text("""
            select id as payment_id, provider, provider_payment_id, amount,
                   wallet_amount, provider_amount, currency,
                   status, reservation_id, expires_at
            from public.payments
            where id = :payment_id
        """), {"payment_id": payment_id}).mappings().one_or_none()
        if row is None:
            raise CheckoutNotFoundError
        return dict(row)
