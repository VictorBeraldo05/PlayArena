export type BookingPaymentMode = 'loading' | 'paid' | 'free';

export function bookingPaymentMode(quote: { payment_required: boolean } | null): BookingPaymentMode {
  if (!quote) return 'loading';
  return quote.payment_required ? 'paid' : 'free';
}
