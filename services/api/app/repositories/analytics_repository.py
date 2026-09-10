from __future__ import annotations

from typing import Any

from sqlalchemy import text

from app.db.session import get_session_factory


def insert_event(event: dict[str, Any], user_id: str | None) -> None:
    with get_session_factory()() as session, session.begin():
        session.execute(text("""
          insert into public.analytics_events
            (event_name, user_id, anonymous_id, session_id, arena_id, court_id, sport_id, reservation_id, properties)
          values
            (:event_name, :user_id, :anonymous_id, :session_id, :arena_id, :court_id, :sport_id, :reservation_id, cast(:properties as jsonb))
        """), {**event, "user_id": user_id, "properties": __import__("json").dumps(event["properties"])} )


def platform_overview(days: int) -> dict[str, Any]:
    params = {"days": days}
    with get_session_factory()() as session:
        overview = session.execute(text("""
          with bounds as (select now() - make_interval(days => :days) as start_at)
          select
            (select count(*) from public.profiles p cross join bounds b where p.created_at >= b.start_at) as users,
            (select count(*) from public.analytics_events e cross join bounds b where e.event_name = 'availability_searched' and e.occurred_at >= b.start_at) as searches,
            (select count(*) from public.reservations r cross join bounds b where r.created_at >= b.start_at) as reservations,
            (select coalesce(sum(r.price) filter (where r.status in ('confirmed','completed')), 0) from public.reservations r cross join bounds b where r.created_at >= b.start_at) as gmv,
            (select coalesce(avg(extract(epoch from (r.confirmed_at-r.created_at))/60) filter (where r.confirmed_at is not null), 0) from public.reservations r cross join bounds b where r.created_at >= b.start_at) as confirmation_minutes
        """), params).mappings().one()
        funnel = session.execute(text("""
          with bounds as (select now() - make_interval(days => :days) as start_at), stages(name, position) as (values
            ('availability_searched', 1), ('availability_results_viewed', 2), ('arena_viewed', 3), ('reservation_started', 4), ('reservation_submitted', 5), ('reservation_confirmed', 6)
          )
          select stages.name, coalesce(case when stages.name = 'reservation_submitted' then (select count(*) from public.reservations r cross join bounds b where r.source='app' and r.created_at >= b.start_at) when stages.name = 'reservation_confirmed' then (select count(*) from public.reservations r cross join bounds b where r.source='app' and r.status in ('confirmed','completed') and r.created_at >= b.start_at) else (select count(distinct e.session_id) from public.analytics_events e cross join bounds b where e.event_name=stages.name and e.occurred_at >= b.start_at) end, 0) as count
          from stages order by stages.position
        """), params).mappings().all()
        demand = session.execute(text("""
          with bounds as (select now() - make_interval(days => :days) as start_at)
          select coalesce(s.name, e.properties->>'sport', 'Não informado') as sport, e.properties->>'city' as city, e.properties->>'time' as time, extract(dow from (e.properties->>'date')::date)::int as weekday, count(*) as count
          from public.analytics_events e left join public.sports s on s.id=e.sport_id cross join bounds b
          where e.event_name='availability_no_results' and e.occurred_at >= b.start_at
          group by 1,2,3,4 order by count desc limit 8
        """), params).mappings().all()
        arenas = session.execute(text("""
          with bounds as (select now() - make_interval(days => :days) as start_at)
          select a.id, a.name, count(r.id) as reservations, count(r.id) filter (where r.status in ('confirmed','completed')) as confirmed, coalesce(sum(r.price) filter (where r.status in ('confirmed','completed')),0) as gmv, coalesce(avg(extract(epoch from (r.confirmed_at-r.created_at))/60) filter (where r.confirmed_at is not null),0) as confirmation_minutes
          from public.arenas a left join public.reservations r on r.arena_id=a.id and r.created_at >= (select start_at from bounds)
          group by a.id, a.name order by gmv desc, reservations desc limit 8
        """), params).mappings().all()
    return {"overview": dict(overview), "funnel": [dict(row) for row in funnel], "unmet_demand": [dict(row) for row in demand], "arenas": [dict(row) for row in arenas]}
