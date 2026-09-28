export function pixExpiryState(payment, now) {
  const deadline = Date.parse(payment.instructions?.expires_at ?? payment.expires_at);
  const secondsLeft = Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - now) / 1000))
    : null;

  return {
    secondsLeft,
    expired: payment.status === 'expired' || secondsLeft === 0,
  };
}
