from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.session import get_session_factory


class BookingConflictError(Exception):
    """Raised when PostgreSQL rejects a conflicting active reservation."""


def available(city: str, sport: str, start_at: datetime) -> list[dict[str, Any]]:
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
              where a.active and c.active and lower(a.city) = lower(:city)
                and (lower(s.name) = lower(:sport) or lower(s.slug) = lower(:sport))
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
            )
        """), {"city": city, "sport": sport, "start_at": start_at}).mappings()
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


def create_player_reservation(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Create an app pending reservation with every sensitive field server-derived."""
    factory = get_session_factory()
    try:
        with factory.begin() as session:
            court = session.execute(text("""
                select c.arena_id, c.default_duration_minutes from public.courts c
                join public.arenas a on a.id = c.arena_id
                where c.id = :court_id and c.active and a.active
            """), data).mappings().one_or_none()
            if court is None:
                raise ValueError("Court is not available.")
            payload = {**data, "arena_id": court["arena_id"], "end_at": data["start_at"] + timedelta(minutes=court["default_duration_minutes"])}
            opening = session.execute(text("""
                select 1 from public.opening_hours where arena_id = :arena_id and active
                  and weekday = CAST(EXTRACT(DOW FROM :start_at) AS smallint)
                  and open_time <= CAST(:start_at AS time) and close_time >= CAST(:end_at AS time)
            """), payload).scalar_one_or_none()
            if opening is None:
                raise ValueError("Court is closed for the full requested period.")
            blocked = session.execute(text("""
                select 1 from public.blocked_slots where court_id = :court_id
                  and tstzrange(start_at, end_at, '[)') && tstzrange(:start_at, :end_at, '[)')
            """), payload).scalar_one_or_none()
            if blocked is not None:
                raise BookingConflictError
            existing_reservation = session.execute(text("""
                select 1 from public.reservations where court_id = :court_id
                  and status in ('pending', 'confirmed')
                  and reservation_window && tstzrange(:start_at, :end_at, '[)')
            """), payload).scalar_one_or_none()
            if existing_reservation is not None:
                raise BookingConflictError
            price = session.execute(text("""
                select pr.price from public.pricing_rules pr where pr.court_id = :court_id and pr.active
                  and pr.weekday = CAST(EXTRACT(DOW FROM :start_at) AS smallint)
                  and pr.start_time <= CAST(:start_at AS time) and pr.end_time >= CAST(:end_at AS time)
                order by (pr.end_time - pr.start_time) asc, pr.created_at desc, pr.id desc limit 1
            """), payload).scalar_one_or_none()
            if price is None:
                raise ValueError("No price rule applies to this time.")
            row = session.execute(text("""
                insert into public.reservations
                  (arena_id, court_id, user_id, customer_name, customer_phone, start_at, end_at, price, status, source)
                values
                  (:arena_id, :court_id, :user_id, :customer_name, :customer_phone, :start_at, :end_at, :price, 'pending', 'app')
                returning id, arena_id, court_id, user_id, customer_name, customer_phone,
                          start_at, end_at, price, status, source
            """), {**payload, "user_id": user_id, "price": price}).mappings().one()
            return dict(row)
    except IntegrityError as exc:
        # PostgreSQL's exclusion constraint remains the final concurrent-write guard.
        raise BookingConflictError from exc


def list_player_reservations(user_id: str) -> list[dict[str, Any]]:
    factory = get_session_factory()
    with factory() as session:
        rows = session.execute(text("""
            select r.id, r.start_at, r.end_at, r.price, r.status, r.source,
                   a.id as arena_id, a.name as arena_name, a.logo_path, c.id as court_id, c.name as court_name
            from public.reservations r join public.arenas a on a.id = r.arena_id
            join public.courts c on c.id = r.court_id
            where r.user_id = :user_id order by r.start_at desc
        """), {"user_id": user_id}).mappings()
        return [dict(row) for row in rows]
