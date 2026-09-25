-- Keep mixed wallet funds available in the immutable ledger until Pix is paid.
alter table public.payments
  add column payment_method text not null default 'pix',
  add column wallet_debited boolean not null default false,
  add column pix_expires_at timestamptz;

update public.payments p
set payment_method = case p.provider
      when 'wallet' then 'wallet'
      when 'sandbox' then 'sandbox'
      else 'checkout_pro'
    end,
    wallet_debited = exists (
      select 1 from public.wallet_transactions wt
      where wt.payment_id = p.id and wt.type = 'booking_debit'
    );

alter table public.payments
  add constraint payments_method_valid check (payment_method in ('pix', 'wallet', 'sandbox', 'checkout_pro')),
  add constraint payments_wallet_debit_consistent check (not wallet_debited or wallet_amount > 0);

create index payments_pending_wallet_reservations_idx
  on public.payments (user_id, expires_at)
  where status = 'pending' and not wallet_debited and wallet_amount > 0;
