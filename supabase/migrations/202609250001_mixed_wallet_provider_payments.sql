-- Mixed wallet + provider checkout. The total booking advance remains in
-- payments.amount while each funding source is persisted independently.

alter table public.payments
  add column wallet_amount numeric(10, 2) not null default 0,
  add column provider_amount numeric(10, 2) not null default 0,
  add column use_wallet_balance boolean not null default false;

update public.payments
set wallet_amount = case when provider = 'wallet' then amount else 0 end,
    provider_amount = case when provider = 'wallet' then 0 else amount end,
    use_wallet_balance = (provider = 'wallet');

alter table public.payments
  add constraint payments_wallet_amount_nonnegative check (wallet_amount >= 0),
  add constraint payments_provider_amount_nonnegative check (provider_amount >= 0),
  add constraint payments_funding_split check (amount = wallet_amount + provider_amount),
  add constraint payments_wallet_request_consistent check (use_wallet_balance or wallet_amount = 0),
  add constraint payments_provider_consistent check (
    (provider = 'wallet' and wallet_amount = amount and provider_amount = 0)
    or (provider <> 'wallet' and provider_amount > 0)
  );

-- A late provider approval may need one credit for the reserved wallet part
-- and another for the externally paid part. Global ledger idempotency keys
-- remain the uniqueness boundary for each financial effect.
drop index if exists public.wallet_transactions_one_credit_per_payment;
