from __future__ import annotations

from collections import defaultdict
from typing import Any
from datetime import date
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.session import get_session_factory


class OwnerResourceNotFoundError(Exception):
    pass


class ReservationConflictError(Exception):
    pass


def _rows(statement: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    session_factory = get_session_factory()
    with session_factory() as session:
        return list(session.execute(text(statement), params or {}).mappings())


def _owned_arena(session: Any, user_id: str, arena_id: UUID) -> dict[str, Any]:
    arena = session.execute(
        text(
            """
            select a.id, a.name, a.slug, a.description, a.phone, a.whatsapp,
                   a.address, a.city, a.state, a.logo_path, a.active
            from public.arenas a
            join public.arena_owners ao on ao.arena_id = a.id
            where a.id = :arena_id and ao.user_id = :user_id
            """
        ),
        {"arena_id": arena_id, "user_id": user_id},
    ).mappings().one_or_none()
    if arena is None:
        raise OwnerResourceNotFoundError
    return dict(arena)


def _owned_court(session: Any, user_id: str, court_id: UUID) -> dict[str, Any]:
    court = session.execute(
        text(
            """
            select c.id, c.arena_id, c.name, c.description, c.active, c.default_duration_minutes
            from public.courts c
            join public.arena_owners ao on ao.arena_id = c.arena_id
            where c.id = :court_id and ao.user_id = :user_id
            """
        ),
        {"court_id": court_id, "user_id": user_id},
    ).mappings().one_or_none()
    if court is None:
        raise OwnerResourceNotFoundError
    return dict(court)


def list_arenas(user_id: str) -> list[dict[str, Any]]:
    return _rows(
        """
        select a.id, a.name, a.slug, a.description, a.phone, a.whatsapp,
               a.address, a.city, a.state, a.logo_path, a.active
        from public.arenas a
        join public.arena_owners ao on ao.arena_id = a.id
        where ao.user_id = :user_id
        order by a.created_at
        """,
        {"user_id": user_id},
    )


def get_arena(user_id: str, arena_id: UUID) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory() as session:
        return _owned_arena(session, user_id, arena_id)


def update_arena(user_id: str, arena_id: UUID, changes: dict[str, Any]) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        _owned_arena(session, user_id, arena_id)
        if changes:
            assignments = ", ".join(f"{field} = :{field}" for field in changes)
            session.execute(
                text(f"update public.arenas set {assignments} where id = :arena_id"),
                {**changes, "arena_id": arena_id},
            )
        return _owned_arena(session, user_id, arena_id)


def list_sports() -> list[dict[str, Any]]:
    return _rows("select id, name, slug from public.sports order by name")


def _attach_sports(session: Any, courts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not courts:
        return courts
    court_ids = [court["id"] for court in courts]
    sport_rows = session.execute(
        text(
            """
            select cs.court_id, s.id, s.name, s.slug
            from public.court_sports cs
            join public.sports s on s.id = cs.sport_id
            where cs.court_id = any(:court_ids)
            order by s.name
            """
        ),
        {"court_ids": court_ids},
    ).mappings()
    sports_by_court: dict[UUID, list[dict[str, Any]]] = defaultdict(list)
    for sport in sport_rows:
        sports_by_court[sport["court_id"]].append(dict(sport))
    for court in courts:
        court["sports"] = sports_by_court[court["id"]]
    return courts


def list_courts(user_id: str, arena_id: UUID) -> list[dict[str, Any]]:
    session_factory = get_session_factory()
    with session_factory() as session:
        _owned_arena(session, user_id, arena_id)
        courts = [
            dict(row)
            for row in session.execute(
                text(
                    """
                    select id, arena_id, name, description, active, default_duration_minutes
                    from public.courts
                    where arena_id = :arena_id
                    order by created_at
                    """
                ),
                {"arena_id": arena_id},
            ).mappings()
        ]
        return _attach_sports(session, courts)


def get_court_sports(user_id: str, court_id: UUID) -> list[dict[str, Any]]:
    session_factory = get_session_factory()
    with session_factory() as session:
        _owned_court(session, user_id, court_id)
        return _court_sports(session, court_id)


def _court_sports(session: Any, court_id: UUID) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in session.execute(
            text(
                """
                select s.id, s.name, s.slug
                from public.court_sports cs
                join public.sports s on s.id = cs.sport_id
                where cs.court_id = :court_id
                order by s.name
                """
            ),
            {"court_id": court_id},
        ).mappings()
    ]


def _validate_sports(session: Any, sport_ids: list[int]) -> None:
    if not sport_ids:
        return
    found = session.execute(
        text("select id from public.sports where id = any(:sport_ids)"),
        {"sport_ids": sport_ids},
    ).scalars().all()
    if set(found) != set(sport_ids):
        raise ValueError("One or more sports do not exist.")


def create_court(user_id: str, arena_id: UUID, input_data: dict[str, Any]) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        _owned_arena(session, user_id, arena_id)
        sport_ids = input_data.pop("sport_ids")
        _validate_sports(session, sport_ids)
        court = session.execute(
            text(
                """
                insert into public.courts (arena_id, name, description, active, default_duration_minutes)
                values (:arena_id, :name, :description, :active, :default_duration_minutes)
                returning id, arena_id, name, description, active, default_duration_minutes
                """
            ),
            {"arena_id": arena_id, **input_data},
        ).mappings().one()
        for sport_id in sport_ids:
            session.execute(
                text("insert into public.court_sports (court_id, sport_id) values (:court_id, :sport_id)"),
                {"court_id": court["id"], "sport_id": sport_id},
            )
        return _attach_sports(session, [dict(court)])[0]


def update_court(user_id: str, court_id: UUID, changes: dict[str, Any]) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        court = _owned_court(session, user_id, court_id)
        if changes.get("active") is True and not _court_sports(session, court_id):
            raise ValueError("Selecione pelo menos uma modalidade.")
        if changes:
            assignments = ", ".join(f"{field} = :{field}" for field in changes)
            session.execute(
                text(f"update public.courts set {assignments} where id = :court_id"),
                {**changes, "court_id": court_id},
            )
        return _attach_sports(session, [_owned_court(session, user_id, court_id)])[0]


def replace_court_sports(user_id: str, court_id: UUID, sport_ids: list[int]) -> list[dict[str, Any]]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        court = _owned_court(session, user_id, court_id)
        if court["active"] and not sport_ids:
            raise ValueError("Selecione pelo menos uma modalidade.")
        _validate_sports(session, sport_ids)
        session.execute(text("delete from public.court_sports where court_id = :court_id"), {"court_id": court_id})
        for sport_id in sport_ids:
            session.execute(
                text("insert into public.court_sports (court_id, sport_id) values (:court_id, :sport_id)"),
                {"court_id": court_id, "sport_id": sport_id},
            )
        return _court_sports(session, court_id)


def list_opening_hours(user_id: str, arena_id: UUID) -> list[dict[str, Any]]:
    session_factory = get_session_factory()
    with session_factory() as session:
        _owned_arena(session, user_id, arena_id)
        return [
            dict(row)
            for row in session.execute(
                text(
                    """
                    select id, arena_id, weekday, open_time, close_time, active
                    from public.opening_hours where arena_id = :arena_id
                    order by weekday, open_time
                    """
                ),
                {"arena_id": arena_id},
            ).mappings()
        ]


def replace_opening_hours(user_id: str, arena_id: UUID, hours: list[dict[str, Any]]) -> list[dict[str, Any]]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        _owned_arena(session, user_id, arena_id)
        session.execute(text("delete from public.opening_hours where arena_id = :arena_id"), {"arena_id": arena_id})
        for hour in hours:
            session.execute(
                text(
                    """
                    insert into public.opening_hours (arena_id, weekday, open_time, close_time, active)
                    values (:arena_id, :weekday, :open_time, :close_time, :active)
                    """
                ),
                {"arena_id": arena_id, **hour},
            )
    return list_opening_hours(user_id, arena_id)


def list_pricing_rules(user_id: str, arena_id: UUID) -> list[dict[str, Any]]:
    session_factory = get_session_factory()
    with session_factory() as session:
        _owned_arena(session, user_id, arena_id)
        return [
            dict(row)
            for row in session.execute(
                text(
                    """
                    select pr.id, pr.court_id, pr.weekday, pr.start_time, pr.end_time, pr.price, pr.active
                    from public.pricing_rules pr
                    join public.courts c on c.id = pr.court_id
                    where c.arena_id = :arena_id
                    order by c.name, pr.weekday, pr.start_time
                    """
                ),
                {"arena_id": arena_id},
            ).mappings()
        ]


def create_pricing_rule(user_id: str, arena_id: UUID, input_data: dict[str, Any]) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        _owned_arena(session, user_id, arena_id)
        _owned_court(session, user_id, input_data["court_id"])
        court_arena_id = session.execute(
            text("select arena_id from public.courts where id = :court_id"), {"court_id": input_data["court_id"]}
        ).scalar_one()
        if court_arena_id != arena_id:
            raise OwnerResourceNotFoundError
        return dict(
            session.execute(
                text(
                    """
                    insert into public.pricing_rules (court_id, weekday, start_time, end_time, price, active)
                    values (:court_id, :weekday, :start_time, :end_time, :price, :active)
                    returning id, court_id, weekday, start_time, end_time, price, active
                    """
                ),
                input_data,
            ).mappings().one()
        )


def _owned_pricing_rule(session: Any, user_id: str, pricing_rule_id: UUID) -> dict[str, Any]:
    rule = session.execute(
        text(
            """
            select pr.id, pr.court_id, pr.weekday, pr.start_time, pr.end_time, pr.price, pr.active
            from public.pricing_rules pr
            join public.courts c on c.id = pr.court_id
            join public.arena_owners ao on ao.arena_id = c.arena_id
            where pr.id = :pricing_rule_id and ao.user_id = :user_id
            """
        ),
        {"pricing_rule_id": pricing_rule_id, "user_id": user_id},
    ).mappings().one_or_none()
    if rule is None:
        raise OwnerResourceNotFoundError
    return dict(rule)


def _owned_reservation(session: Any, user_id: str, reservation_id: UUID) -> dict[str, Any]:
    reservation = session.execute(
        text(
            """
            select r.id, r.arena_id, r.court_id, r.status
            from public.reservations r
            join public.arena_owners ao on ao.arena_id = r.arena_id
            where r.id = :reservation_id and ao.user_id = :user_id
            """
        ),
        {"reservation_id": reservation_id, "user_id": user_id},
    ).mappings().one_or_none()
    if reservation is None:
        raise OwnerResourceNotFoundError
    return dict(reservation)


def update_pricing_rule(user_id: str, pricing_rule_id: UUID, changes: dict[str, Any]) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        existing = _owned_pricing_rule(session, user_id, pricing_rule_id)
        merged = {**existing, **changes}
        if merged["start_time"] >= merged["end_time"]:
            raise ValueError("start_time must be before end_time")
        if changes:
            assignments = ", ".join(f"{field} = :{field}" for field in changes)
            session.execute(
                text(f"update public.pricing_rules set {assignments} where id = :pricing_rule_id"),
                {**changes, "pricing_rule_id": pricing_rule_id},
            )
        return _owned_pricing_rule(session, user_id, pricing_rule_id)


def delete_pricing_rule(user_id: str, pricing_rule_id: UUID) -> None:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        _owned_pricing_rule(session, user_id, pricing_rule_id)
        session.execute(text("delete from public.pricing_rules where id = :pricing_rule_id"), {"pricing_rule_id": pricing_rule_id})


def create_blocked_slot(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        court = _owned_court(session, user_id, data["court_id"])
        return dict(session.execute(text("""insert into public.blocked_slots(court_id,start_at,end_at,reason,created_by) values(:court_id,:start_at,:end_at,:reason,:user_id) returning id,court_id,start_at,end_at,reason"""), {**data,"user_id":user_id}).mappings().one())


def create_manual_reservation(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    session_factory = get_session_factory()
    try:
        with session_factory.begin() as session:
            court = _owned_court(session, user_id, data["court_id"])
            return dict(session.execute(text("""insert into public.reservations(arena_id,court_id,customer_name,customer_phone,start_at,end_at,price,status,source,confirmed_at) values(:arena_id,:court_id,:customer_name,:customer_phone,:start_at,:end_at,:price,'confirmed','arena_manual',timezone('utc', now())) returning id,arena_id,court_id,customer_name,customer_phone,start_at,end_at,price,status,source"""), {**data,"arena_id":court["arena_id"]}).mappings().one())
    except IntegrityError as exc:
        raise ReservationConflictError from exc


def update_reservation_status(user_id: str, reservation_id: UUID, next_status: str) -> dict[str, Any]:
    session_factory = get_session_factory()
    try:
        with session_factory.begin() as session:
            _owned_reservation(session, user_id, reservation_id)
            return dict(session.execute(text("""update public.reservations set status=:status,
              confirmed_at=case when :status='confirmed' then coalesce(confirmed_at, timezone('utc', now())) else confirmed_at end,
              cancelled_at=case when :status='cancelled' then coalesce(cancelled_at, timezone('utc', now())) else cancelled_at end
              where id=:reservation_id returning id,status"""), {"status":next_status,"reservation_id":reservation_id}).mappings().one())
    except IntegrityError as exc:
        raise ReservationConflictError from exc


def list_owner_reservations(user_id: str) -> list[dict[str, Any]]:
    return _rows("""select r.id,r.arena_id,r.court_id,r.customer_name,r.customer_phone,r.start_at,r.end_at,r.price,r.status,r.source,c.name court_name from public.reservations r join public.courts c on c.id=r.court_id join public.arena_owners ao on ao.arena_id=r.arena_id where ao.user_id=:user_id order by r.start_at desc""", {"user_id": user_id})


def list_owner_blocked_slots(user_id: str) -> list[dict[str, Any]]:
    return _rows("""select b.id,b.court_id,b.start_at,b.end_at,b.reason,c.name court_name from public.blocked_slots b join public.courts c on c.id=b.court_id join public.arena_owners ao on ao.arena_id=c.arena_id where ao.user_id=:user_id order by b.start_at""", {"user_id": user_id})


def _owned_blocked_slot(session: Any, user_id: str, blocked_slot_id: UUID) -> dict[str, Any]:
    blocked_slot = session.execute(text("""
        select b.id, b.court_id from public.blocked_slots b
        join public.courts c on c.id = b.court_id
        join public.arena_owners ao on ao.arena_id = c.arena_id
        where b.id = :blocked_slot_id and ao.user_id = :user_id
    """), {"blocked_slot_id": blocked_slot_id, "user_id": user_id}).mappings().one_or_none()
    if blocked_slot is None:
        raise OwnerResourceNotFoundError
    return dict(blocked_slot)


def delete_blocked_slot(user_id: str, blocked_slot_id: UUID) -> None:
    session_factory = get_session_factory()
    with session_factory.begin() as session:
        _owned_blocked_slot(session, user_id, blocked_slot_id)
        session.execute(text("delete from public.blocked_slots where id = :blocked_slot_id"), {"blocked_slot_id": blocked_slot_id})


def get_dashboard_summary(user_id: str) -> dict[str, Any]:
    """Return operational metrics across every arena owned by the user.

    Occupancy measures reservation time only. Blocked slots make a court
    unavailable but are not a customer booking and therefore do not inflate
    operational occupancy or app revenue.
    """
    session_factory = get_session_factory()
    with session_factory() as session:
        summary = session.execute(text("""
            with owned as (
              select arena_id from public.arena_owners where user_id = :user_id
            ),
            boundaries as (
              select
                date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as day_start,
                (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo' as day_end,
                date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as week_start,
                (date_trunc('week', now() at time zone 'America/Sao_Paulo') + interval '7 days') at time zone 'America/Sao_Paulo' as week_end,
                date_trunc('day', now() at time zone 'America/Sao_Paulo') as local_day
            ),
            capacity as (
              select coalesce(sum(extract(epoch from (oh.close_time - oh.open_time))), 0) as seconds
              from public.courts c join owned o on o.arena_id = c.arena_id
              join public.opening_hours oh on oh.arena_id = c.arena_id
              cross join boundaries b
              where c.active and oh.active
                and oh.weekday = extract(dow from b.local_day)::smallint
            )
            select
              count(r.id) filter (where r.status in ('pending', 'confirmed', 'completed') and r.start_at >= b.day_start and r.start_at < b.day_end) as reservations_today,
              count(r.id) filter (where r.status in ('pending', 'confirmed', 'completed') and r.start_at >= b.week_start and r.start_at < b.week_end) as reservations_week,
              coalesce(sum(r.price) filter (where r.source = 'app' and r.status in ('confirmed', 'completed')), 0) as app_revenue,
              coalesce(round((100 * coalesce(sum(extract(epoch from least(r.end_at, b.day_end) - greatest(r.start_at, b.day_start))) filter (where r.status in ('pending', 'confirmed') and r.start_at < b.day_end and r.end_at > b.day_start), 0) / nullif(capacity.seconds, 0))::numeric, 1), 0) as occupancy_today,
              count(r.id) filter (where r.status = 'pending') as pending_count
            from owned o cross join boundaries b cross join capacity
            left join public.reservations r on r.arena_id = o.arena_id
            group by b.day_start, b.day_end, b.week_start, b.week_end, capacity.seconds
        """), {"user_id": user_id}).mappings().one()
        next_rows = session.execute(text("""
            select r.id, r.start_at, r.end_at, r.status, r.source, r.price, r.customer_name, a.name as arena_name, c.name as court_name
            from public.reservations r join public.arenas a on a.id = r.arena_id
            join public.courts c on c.id = r.court_id join public.arena_owners ao on ao.arena_id = r.arena_id
            where ao.user_id = :user_id and r.status in ('pending', 'confirmed') and r.start_at >= now()
            order by r.start_at limit 5
        """), {"user_id": user_id}).mappings()
        return {**dict(summary), "next_reservations": [dict(row) for row in next_rows]}


def get_agenda_slots(user_id: str, day: date, court_id: UUID | None = None) -> list[dict[str, Any]]:
    """Build day slots server-side from the same persisted operational rules."""
    session_factory = get_session_factory()
    with session_factory() as session:
        rows = session.execute(text("""
            with owned_courts as (
              select c.id, c.name, c.arena_id, c.default_duration_minutes
              from public.courts c join public.arena_owners ao on ao.arena_id = c.arena_id
              where ao.user_id = :user_id and c.active
                and (cast(:court_id as uuid) is null or c.id = cast(:court_id as uuid))
            ), slots as (
              select c.id as court_id, c.name as court_name,
                     series as start_at, series + make_interval(mins => c.default_duration_minutes) as end_at
              from owned_courts c join public.opening_hours oh on oh.arena_id = c.arena_id
              cross join lateral generate_series(
                CAST(CAST(:day AS date) + oh.open_time AS timestamp),
                CAST(CAST(:day AS date) + oh.close_time - make_interval(mins => c.default_duration_minutes) AS timestamp),
                make_interval(mins => c.default_duration_minutes)
              ) series
              where oh.active and oh.weekday = CAST(EXTRACT(DOW FROM CAST(:day AS date)) AS smallint)
            )
            select s.*, r.id as reservation_id, r.customer_name, r.customer_phone, r.price, r.status, r.source,
                   b.id as blocked_slot_id, b.reason as blocked_reason
            from slots s
            left join lateral (
              select * from public.reservations r where r.court_id = s.court_id
                and r.status in ('pending', 'confirmed')
                and r.reservation_window && tstzrange(s.start_at, s.end_at, '[)') limit 1
            ) r on true
            left join lateral (
              select * from public.blocked_slots b where b.court_id = s.court_id
                and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(s.start_at, s.end_at, '[)') limit 1
            ) b on true
            order by s.start_at, s.court_name
        """), {"user_id": user_id, "day": day, "court_id": court_id}).mappings()
        return [dict(row) for row in rows]


def get_dashboard(user_id: str, arena_id: UUID) -> dict[str, Any]:
    session_factory = get_session_factory()
    with session_factory() as session:
        arena = _owned_arena(session, user_id, arena_id)
        counts = session.execute(
            text(
                """
                select
                  (select count(*) from public.courts where arena_id = :arena_id) as court_count,
                  (select count(distinct cs.sport_id) from public.courts c join public.court_sports cs on cs.court_id = c.id where c.arena_id = :arena_id) as sport_count,
                  exists(select 1 from public.opening_hours where arena_id = :arena_id and active) as opening_hours_configured,
                  exists(select 1 from public.pricing_rules pr join public.courts c on c.id = pr.court_id where c.arena_id = :arena_id and pr.active) as pricing_rules_configured
                """
            ),
            {"arena_id": arena_id},
        ).mappings().one()
        return {"arena": arena, **dict(counts)}
