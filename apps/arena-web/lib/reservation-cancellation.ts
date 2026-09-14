export const PLAYER_CANCELLATION_MINUTES = 90;

type CancellationCandidate = { start_at: string; status: string };

export function playerCancellationDeadline(startAt: string): Date | null {
  const startAtMilliseconds = Date.parse(startAt);
  if (!Number.isFinite(startAtMilliseconds)) return null;
  return new Date(startAtMilliseconds - PLAYER_CANCELLATION_MINUTES * 60 * 1000);
}

export function canPlayerCancelReservation(reservation: CancellationCandidate, nowMilliseconds = Date.now()): boolean {
  if (!['pending', 'confirmed'].includes(reservation.status)) return false;
  const deadline = playerCancellationDeadline(reservation.start_at);
  return Boolean(deadline && nowMilliseconds <= deadline.getTime());
}
