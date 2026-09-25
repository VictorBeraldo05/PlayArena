-- Payments v1: server-owned checkout, expiring slot holds and immutable credits.
-- Existing reservations keep their original `price`; the new columns snapshot
-- the financial split used when each reservation was created.

create table public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  arena_id uuid not null references public.arenas (id) on delete restrict,
  court_id uuid not null references public.courts (id) on delete restrict,
  sport_id bigint references public.sports (id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  court_price_total numeric(10, 2) not null check (court_price_total >= 0),
  booking_amount numeric(10, 2) not null check (booking_amount > 0),
  amount_due_at_venue numeric(10, 2) not null check (amount_due_at_venue >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'active' check (status in ('active', 'converted', 'cancelled', 'expired')),
  idempotency_key text not null,
  expires_at timestamptz not null,
  reservation_id uuid references public.reservations (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  hold_window tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  check (start_at < end_at),
  check (booking_amount <= court_price_total),
  check (court_price_total = booking_amount + amount_due_at_venue),
  unique (user_id, idempotency_key)
);

alter table public.booking_holds
  add constraint booking_holds_no_overlap_active
  exclude using gist (court_id with =, hold_window with &&)
  where (status = 'active');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null unique references public.booking_holds (id) on delete restrict,
  reservation_id uuid unique references public.reservations (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  provider text not null check (provider in ('wallet', 'sandbox', 'mercado_pago')),
  provider_payment_id text,
  amount numeric(10, 2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null check (status in ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  idempotency_key text not null,
  checkout_url text,
  failure_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  paid_at timestamptz,
  failed_at timestamptz,
  expires_at timestamptz not null,
  unique (user_id, idempotency_key),
  unique (provider, provider_payment_id),
  check ((status = 'paid' and paid_at is not null) or status <> 'paid')
);

alter table public.reservations
  add column sport_id bigint references public.sports (id) on delete set null,
  add column court_price_total numeric(10, 2),
  add column booking_amount_paid numeric(10, 2),
  add column amount_due_at_venue numeric(10, 2),
  add column currency text,
  add column payment_id uuid unique references public.payments (id) on delete restrict;

update public.reservations
set court_price_total = price,
    booking_amount_paid = 0,
    amount_due_at_venue = price,
    currency = 'BRL'
where court_price_total is null;

alter table public.reservations
  alter column court_price_total set not null,
  alter column booking_amount_paid set not null,
  alter column amount_due_at_venue set not null,
  alter column currency set not null,
  alter column currency set default 'BRL',
  add constraint reservations_court_price_total_nonnegative check (court_price_total >= 0),
  add constraint reservations_booking_amount_paid_nonnegative check (booking_amount_paid >= 0),
  add constraint reservations_amount_due_nonnegative check (amount_due_at_venue >= 0),
  add constraint reservations_currency_brl check (currency = 'BRL'),
  add constraint reservations_financial_split check (court_price_total = booking_amount_paid + amount_due_at_venue),
  add constraint reservations_price_snapshot_matches check (price = court_price_total);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  type text not null check (type in ('refund_credit', 'booking_debit', 'admin_adjustment')),
  amount numeric(10, 2) not null check (amount <> 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  reservation_id uuid references public.reservations (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  reason text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  check (
    (type = 'refund_credit' and amount > 0 and (reservation_id is not null or payment_id is not null))
    or (type = 'booking_debit' and amount < 0 and payment_id is not null)
    or (type = 'admin_adjustment')
  )
);

create unique index wallet_transactions_one_refund_per_reservation
  on public.wallet_transactions (reservation_id)
  where type = 'refund_credit';

create unique index wallet_transactions_one_debit_per_payment
  on public.wallet_transactions (payment_id)
  where type = 'booking_debit';

create unique index wallet_transactions_one_credit_per_payment
  on public.wallet_transactions (payment_id)
  where type = 'refund_credit' and payment_id is not null;

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('sandbox', 'mercado_pago')),
  provider_event_id text not null,
  payment_id uuid references public.payments (id) on delete set null,
  payload_sha256 text not null check (length(payload_sha256) = 64),
  result text not null check (result in ('processed', 'duplicate', 'rejected', 'ignored')),
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index booking_holds_user_created_idx on public.booking_holds (user_id, created_at desc);
create index booking_holds_active_slot_idx on public.booking_holds (court_id, start_at, end_at) where status = 'active';
create index booking_holds_expiration_idx on public.booking_holds (expires_at) where status = 'active';
create index payments_user_created_idx on public.payments (user_id, created_at desc);
create index payments_status_created_idx on public.payments (status, created_at desc);
create index wallet_transactions_user_created_idx on public.wallet_transactions (user_id, created_at desc);

create trigger set_booking_holds_updated_at
before update on public.booking_holds
for each row execute function public.set_updated_at();

create trigger set_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create or replace function public.enforce_payment_status_transition()
returns trigger language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status = 'pending' and new.status in ('paid', 'failed', 'expired', 'cancelled'))
    or (old.status = 'expired' and new.status = 'paid')
  ) then
    raise exception 'invalid payment status transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger enforce_payment_status_transition
before update of status on public.payments
for each row execute function public.enforce_payment_status_transition();

create or replace function public.enforce_hold_status_transition()
returns trigger language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if old.status <> 'active' or new.status not in ('converted', 'cancelled', 'expired') then
    raise exception 'invalid hold status transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger enforce_hold_status_transition
before update of status on public.booking_holds
for each row execute function public.enforce_hold_status_transition();

create or replace function public.prevent_wallet_transaction_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'wallet transactions are immutable';
end;
$$;

create or replace function public.ensure_wallet_nonnegative()
returns trigger language plpgsql as $$
declare
  current_balance numeric(10, 2);
begin
  -- Serialize every ledger write for a user on the stable profile row.
  perform 1 from public.profiles where id = new.user_id for update;
  select coalesce(sum(amount), 0) into current_balance
  from public.wallet_transactions where user_id = new.user_id and currency = new.currency;
  if current_balance + new.amount < 0 then
    raise exception 'wallet balance cannot be negative';
  end if;
  return new;
end;
$$;

create trigger ensure_wallet_nonnegative
before insert on public.wallet_transactions
for each row execute function public.ensure_wallet_nonnegative();

create trigger prevent_wallet_transaction_update
before update on public.wallet_transactions
for each row execute function public.prevent_wallet_transaction_mutation();

create trigger prevent_wallet_transaction_delete
before delete on public.wallet_transactions
for each row execute function public.prevent_wallet_transaction_mutation();

alter table public.booking_holds enable row level security;
alter table public.payments enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.payment_webhook_events enable row level security;

create policy "booking_holds_select_own" on public.booking_holds
for select to authenticated using (user_id = auth.uid());

create policy "payments_select_own" on public.payments
for select to authenticated using (user_id = auth.uid());

create policy "wallet_transactions_select_own" on public.wallet_transactions
for select to authenticated using (user_id = auth.uid());

create policy "payments_admin_select" on public.payments
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

create policy "wallet_transactions_admin_select" on public.wallet_transactions
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

grant select on public.booking_holds, public.payments, public.wallet_transactions to authenticated;
revoke all on public.booking_holds, public.payments, public.wallet_transactions, public.payment_webhook_events from anon;
revoke insert, update, delete on public.booking_holds, public.payments, public.wallet_transactions from authenticated;
revoke all on public.payment_webhook_events from authenticated;
revoke all on function public.enforce_payment_status_transition() from public, anon, authenticated;
revoke all on function public.enforce_hold_status_transition() from public, anon, authenticated;
revoke all on function public.prevent_wallet_transaction_mutation() from public, anon, authenticated;
revoke all on function public.ensure_wallet_nonnegative() from public, anon, authenticated;

-- checkout_started is the only client-side payment-funnel event. Financial
-- outcomes are derived from the server-owned payment and ledger tables.
alter table public.analytics_events drop constraint if exists analytics_events_event_name_check;
alter table public.analytics_events add constraint analytics_events_event_name_check check (event_name in (
  'app_opened', 'search_started', 'availability_searched', 'availability_results_viewed',
  'availability_no_results', 'arena_viewed', 'arena_schedule_viewed',
  'reservation_started', 'reservation_login_required', 'checkout_started'
));
