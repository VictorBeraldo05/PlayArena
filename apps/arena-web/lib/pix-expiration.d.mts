export type PixExpiryPayment = {
  status: string;
  expires_at: string;
  instructions?: { expires_at: string | null } | null;
};

export declare function pixExpiryState(
  payment: PixExpiryPayment,
  now: number,
): { secondsLeft: number | null; expired: boolean };
