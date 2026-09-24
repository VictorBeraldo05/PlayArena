-- Keep the database allowlist aligned with the event accepted by the API.
alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (event_name in (
    'app_opened', 'search_started', 'availability_searched', 'availability_results_viewed',
    'availability_no_results', 'arena_viewed', 'arena_schedule_viewed',
    'reservation_started', 'reservation_login_required'
  ));
