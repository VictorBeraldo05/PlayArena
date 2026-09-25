from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.session import get_session_factory
from app.repositories.payment_repository import credit_reservation_payment
from app.schemas.booking import SAO_PAULO_TIME_ZONE


class BookingConflictError(Exception):
    """Raised when PostgreSQL rejects a conflicting active reservation."""


class PublicScheduleCourtNotFoundError(Exception):
    """Raised when a requested court is not an active court of the public arena."""


class PlayerReservationNotFoundError(Exception):
    """Raised without exposing whether another player's reservation exists."""


class PlayerReservationStateError(Exception):
    """Raised when a reservation is not in a player-cancellable status."""


class PlayerCancellationWindowClosedError(Exception):
    """Raised when the 90-minute player cancellation window has passed."""


class PlayerReservationCancellationConflictError(Exception):
    """Raised when the reservation changes while the cancellation is being applied."""


def available(city: str | None, sport: str, start_at: datetime, arena_id: UUID | None = None, court_id: UUID | None = None) -> list[dict[str, Any]]:
    """Return courts where the full default-duration slot is bookable.

    A pricing rule covers the whole slot. The narrowest matching range wins;
    equal ranges use the newest rule and then its id as deterministic ties.
    """
    factory = get_session_factory()
    with factory() as session:
        rows = session.execute(text("""
            with candidates as (
              select a.id as arena_id, a.name as arena_name, a.logo_path, c.id as court_id,
                     c.name as court_name, c.default_duration_minutes as duration_minutes, :start_at as start_at,
                     :start_at + make_interval(mins => c.default_duration_minutes) as end_at
              from public.arenas a join public.courts c on c.arena_id = a.id
              join public.court_sports cs on cs.court_id = c.id
              join public.sports s on s.id = cs.sport_id
              where a.active and c.active
                and (cast(:city as text) is null or lower(a.city) = lower(cast(:city as text)))
                and (lower(s.name) = lower(:sport) or lower(s.slug) = lower(:sport))
                and (cast(:arena_id as uuid) is null or a.id = cast(:arena_id as uuid))
                and (cast(:court_id as uuid) is null or c.id = cast(:court_id as uuid))
            )
            select ca.*, (
              select pr.price from public.pricing_rules pr
              where pr.court_id = ca.court_id and pr.active
                and pr.weekday = extract(dow from ca.start_at)::smallint
                and pr.start_time <= ca.start_at::time and pr.end_time >= ca.end_at::time
              order by (pr.end_time - pr.start_time) asc, pr.created_at desc, pr.id desc limit 1
            ) as price
            from candidates ca
            where exists (
              select 1 from public.opening_hours oh where oh.arena_id = ca.arena_id and oh.active
                and oh.weekday = extract(dow from ca.start_at)::smallint
                and oh.open_time <= ca.start_at::time and oh.close_time >= ca.end_at::time
            ) and not exists (
              select 1 from public.blocked_slots b where b.court_id = ca.court_id
                and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(ca.start_at, ca.end_at, '[)')
            ) and not exists (
              select 1 from public.reservations r where r.court_id = ca.court_id
                and r.status in ('pending', 'confirmed')
                and r.reservation_window && tstzrange(ca.start_at, ca.end_at, '[)')
            ) and not exists (
              select 1 from public.booking_holds h where h.court_id = ca.court_id
                and h.status = 'active' and h.expires_at > timezone('utc', now())
                and h.hold_window && tstzrange(ca.start_at, ca.end_at, '[)')
            )
        """), {"city": city, "sport": sport, "start_at": start_at, "arena_id": arena_id, "court_id": court_id}).mappings()
        return [dict(row) for row in rows if row["price"] is not None]


def public_arenas(city: str | None = None) -> list[dict[str, Any]]:
    factory = get_session_factory()
    with factory() as session:
        rows = session.execute(text("""
            select a.id, a.name, a.city, a.description, a.logo_path,
              (select count(*) from public.courts c where c.arena_id = a.id and c.active) as court_count,
              coalesce((
                select array_agg(distinct s.name)
                from public.courts c join public.court_sports cs on cs.court_id = c.id
                join public.sports s on s.id = cs.sport_id
                where c.arena_id = a.id and c.active
              ), array[]::text[]) as sports,
              (
                select min(pr.price) from public.courts c join public.pricing_rules pr on pr.court_id = c.id
                where c.arena_id = a.id and c.active and pr.active
              ) as price_from
            from public.arenas a
            where a.active and (cast(:city as text) is null or lower(a.city) = lower(cast(:city as text)))
              and exists (select 1 from public.courts c where c.arena_id = a.id and c.active)
            order by a.name
        """), {"city": city}).mappings()
        return [dict(row) for row in rows]


def public_arena(arena_id: UUID) -> dict[str, Any] | None:
    """Return public configuration only; owner and customer data is excluded."""
    factory = get_session_factory()
    with factory() as session:
        arena = session.execute(text("""
            select id, name, description, address, city, state, phone, whatsapp, logo_path
            from public.arenas where id = :arena_id and active
        """), {"arena_id": arena_id}).mappings().one_or_none()
        if arena is None:
            return None
        courts = session.execute(text("""
            select c.id, c.name, c.description, c.default_duration_minutes,
                   coalesce(array_agg(distinct s.name) filter (where s.name is not null), '{}') as sports,
                   min(pr.price) as price_from
            from public.courts c left join public.court_sports cs on cs.court_id = c.id
            left join public.sports s on s.id = cs.sport_id
            left join public.pricing_rules pr on pr.court_id = c.id and pr.active
            where c.arena_id = :arena_id and c.active group by c.id order by c.name
        """), {"arena_id": arena_id}).mappings()
        hours = session.execute(text("""
            select weekday, open_time, close_time from public.opening_hours
            where arena_id = :arena_id and active order by weekday, open_time
        """), {"arena_id": arena_id}).mappings()
        return {**dict(arena), "courts": [dict(row) for row in courts], "opening_hours": [dict(row) for row in hours]}


def public_arena_schedule(arena_id: UUID, day: date, court_id: UUID | None = None) -> dict[str, Any] | None:
    """Return a public, privacy-safe schedule with server-resolved availability and pricing."""
    factory = get_session_factory()
    with factory() as session:
        arena = session.execute(text("""
            select id from public.arenas where id = :arena_id and active
        """), {"arena_id": arena_id}).mappings().one_or_none()
        if arena is None:
            return None

        courts = [dict(row) for row in session.execute(text("""
            select c.id, c.name, c.default_duration_minutes,
                   coalesce(array_agg(distinct s.name) filter (where s.name is not null), '{}') as sports
            from public.courts c
            left join public.court_sports cs on cs.court_id = c.id
            left join public.sports s on s.id = cs.sport_id
            where c.arena_id = :arena_id and c.active
              and (cast(:court_id as uuid) is null or c.id = cast(:court_id as uuid))
            group by c.id order by c.name
        """), {"arena_id": arena_id, "court_id": court_id}).mappings()]
        if court_id is not None and not courts:
            raise PublicScheduleCourtNotFoundError

        is_open = session.execute(text("""
            select exists(
              select 1 from public.opening_hours oh
              where oh.arena_id = :arena_id and oh.active
                and oh.weekday = extract(dow from cast(:day as date))::smallint
            )
        """), {"arena_id": arena_id, "day": day}).scalar_one()
        if not courts or not is_open:
            return {"arena_id": arena["id"], "day": day, "is_open": is_open, "courts": courts, "slots": []}

        slots = session.execute(text("""
            with selected_courts as (
              select c.id as court_id, c.default_duration_minutes
              from public.courts c
              where c.arena_id = :arena_id and c.active
                and (cast(:court_id as uuid) is null or c.id = cast(:court_id as uuid))
            ), time_slots as (
              select c.court_id, c.default_duration_minutes as duration_minutes,
                     series.start_at, series.start_at + make_interval(mins => c.default_duration_minutes) as end_at
              from selected_courts c
              join public.opening_hours oh on oh.arena_id = :arena_id and oh.active
                and oh.weekday = extract(dow from cast(:day as date))::smallint
              cross join lateral generate_series(
                timezone('America/Sao_Paulo', cast(:day as date) + oh.open_time),
                timezone('America/Sao_Paulo', cast(:day as date) + oh.close_time - make_interval(mins => c.default_duration_minutes)),
                make_interval(mins => c.default_duration_minutes)
              ) as series(start_at)
            ), resolved_slots as (
              select slot.*,
                exists(
                  select 1 from public.blocked_slots b
                  where b.court_id = slot.court_id
                    and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(slot.start_at, slot.end_at, '[)')
                ) as is_blocked,
                exists(
                  select 1 from public.reservations r
                  where r.court_id = slot.court_id and r.status in ('pending', 'confirmed')
                    and r.reservation_window && tstzrange(slot.start_at, slot.end_at, '[)')
                ) as is_reserved,
                exists(
                  select 1 from public.booking_holds h
                  where h.court_id = slot.court_id and h.status = 'active'
                    and h.expires_at > timezone('utc', now())
                    and h.hold_window && tstzrange(slot.start_at, slot.end_at, '[)')
                ) as is_held,
                (
                  select pr.price from public.pricing_rules pr
                  where pr.court_id = slot.court_id and pr.active
                    and pr.weekday = extract(dow from slot.start_at at time zone 'America/Sao_Paulo')::smallint
                    and pr.start_time <= (slot.start_at at time zone 'America/Sao_Paulo')::time
                    and pr.end_time >= (slot.end_at at time zone 'America/Sao_Paulo')::time
                  order by (pr.end_time - pr.start_time) asc, pr.created_at desc, pr.id desc limit 1
                ) as price
              from time_slots slot
            )
            select court_id, start_at, end_at, duration_minutes,
              case
                when start_at <= now() then 'past'
                when is_blocked then 'blocked'
                when is_reserved or is_held then 'reserved'
                when price is null then 'unavailable'
                else 'available'
              end as status,
              case when start_at > now() and not is_blocked and not is_reserved and not is_held then price else null end as price
            from resolved_slots
            order by start_at, court_id
        """), {"arena_id": arena_id, "court_id": court_id, "day": day}).mappings()
        return {"arena_id": arena["id"], "day": day, "is_open": is_open, "courts": courts, "slots": [dict(row) for row in slots]}


def create_player_reservation(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Reject the legacy path; paid app reservations are created by checkout only."""
    del user_id, data
    raise ValueError("Payment checkout is required before creating a reservation.")


def cancel_player_reservation(
    user_id: str,
    reservation_id: UUID,
    current_time: datetime | None = None,
) -> dict[str, Any]:
    """Cancel an active player reservation through the inclusive 90-minute deadline."""
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        reservation = session.execute(text("""
            select id, status, start_at, user_id, payment_id, booking_amount_paid
            from public.reservations
            where id = :reservation_id and user_id = :user_id
            for update
        """), {"reservation_id": reservation_id, "user_id": user_id}).mappings().one_or_none()
        if reservation is None:
            raise PlayerReservationNotFoundError
        if reservation["status"] not in {"pending", "confirmed"}:
            raise PlayerReservationStateError

        now = current_time or datetime.now(SAO_PAULO_TIME_ZONE)
        local_now = now.replace(tzinfo=SAO_PAULO_TIME_ZONE) if now.tzinfo is None else now.astimezone(SAO_PAULO_TIME_ZONE)
        start_at = reservation["start_at"]
        local_start = start_at.replace(tzinfo=SAO_PAULO_TIME_ZONE) if start_at.tzinfo is None else start_at.astimezone(SAO_PAULO_TIME_ZONE)
        if local_now > local_start - timedelta(minutes=90):
            raise PlayerCancellationWindowClosedError

        row = session.execute(text("""
            update public.reservations
            set status = 'cancelled', cancelled_at = coalesce(cancelled_at, :cancelled_at)
            where id = :reservation_id and user_id = :user_id and status = :current_status
              and :cancelled_at <= start_at - interval '90 minutes'
            returning id, status, cancelled_at
        """), {
            "reservation_id": reservation_id,
            "user_id": user_id,
            "current_status": reservation["status"],
            "cancelled_at": local_now,
        }).mappings().one_or_none()
        if row is None:
            raise PlayerReservationCancellationConflictError
        refunded = credit_reservation_payment(session, dict(reservation), "Cancelamento solicitado pelo player")
        return {**dict(row), "previous_status": reservation["status"], "credited_to_wallet": refunded}


def list_player_reservations(user_id: str) -> list[dict[str, Any]]:
    factory = get_session_factory()
    with factory() as session:
        rows = session.execute(text("""
            select r.id, r.start_at, r.end_at, r.price, r.court_price_total,
                   r.booking_amount_paid, r.amount_due_at_venue, r.currency, r.status, r.source,
                   a.id as arena_id, a.name as arena_name, a.logo_path, c.id as court_id, c.name as court_name
            from public.reservations r join public.arenas a on a.id = r.arena_id
            join public.courts c on c.id = r.court_id
            where r.user_id = :user_id order by r.start_at desc
        """), {"user_id": user_id}).mappings()
        return [dict(row) for row in rows]


def get_reservation_notification(reservation_id: UUID) -> dict[str, Any] | None:
    """Load server-owned reservation data for a player status notification."""
    factory = get_session_factory()
    with factory() as session:
        row = session.execute(text("""
            select r.id, u.email as recipient_email,
                   a.name as arena_name, c.name as court_name,
                   coalesce((
                     select string_agg(s.name, ', ' order by s.name)
                     from public.court_sports cs
                     join public.sports s on s.id = cs.sport_id
                     where cs.court_id = r.court_id
                   ), 'Modalidade não informada') as sport_name,
                   r.start_at, r.end_at, r.price, r.court_price_total,
                   r.booking_amount_paid, r.amount_due_at_venue,
                   exists(select 1 from public.wallet_transactions wt
                          where wt.reservation_id = r.id and wt.type = 'refund_credit') as credited_to_wallet
            from public.reservations r
            join public.arenas a on a.id = r.arena_id
            join public.courts c on c.id = r.court_id
            left join auth.users u on u.id = r.user_id
            where r.id = :reservation_id
        """), {"reservation_id": reservation_id}).mappings().one_or_none()
        return dict(row) if row else None
