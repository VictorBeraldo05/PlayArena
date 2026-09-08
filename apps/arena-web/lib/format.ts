export const BRAZIL_LOCALE = 'pt-BR';
export const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';

const dateFormatter = new Intl.DateTimeFormat(BRAZIL_LOCALE, {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: BRAZIL_TIME_ZONE,
});
const timeFormatter = new Intl.DateTimeFormat(BRAZIL_LOCALE, {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BRAZIL_TIME_ZONE,
});
const reservationDatePartsFormatter = new Intl.DateTimeFormat(BRAZIL_LOCALE, {
  weekday: 'short', day: '2-digit', month: 'short', timeZone: BRAZIL_TIME_ZONE,
});

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

function localDateTimeParts(value: string) {
  const match = localDateTimePattern.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return { year, month, day, hour, minute };
}

export function formatCurrencyBRL(value: string | number | null | undefined): string {
  return new Intl.NumberFormat(BRAZIL_LOCALE, { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));
}

export function parseCurrencyBRL(value: string): number | null {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

export function formatDateBR(value: string | Date): string {
  if (typeof value === 'string') {
    const parts = localDateTimeParts(value);
    if (parts) return `${parts.day}/${parts.month}/${parts.year}`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  return dateFormatter.format(new Date(value));
}

export function formatTimeBR(value: string | Date): string {
  if (typeof value === 'string' && /^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  if (typeof value === 'string') {
    const parts = localDateTimeParts(value);
    if (parts) return `${parts.hour}:${parts.minute}`;
  }
  return timeFormatter.format(new Date(value));
}

export function formatReservationTimeRange(startAt: string | Date, endAt: string | Date): string {
  return `${formatTimeBR(startAt)} às ${formatTimeBR(endAt)}`;
}

export function formatReservationDateParts(value: string | Date): { weekday: string; day: string; month: string } {
  const localParts = typeof value === 'string' ? localDateTimeParts(value) : null;
  const date = localParts
    ? new Date(Date.UTC(Number(localParts.year), Number(localParts.month) - 1, Number(localParts.day)))
    : new Date(value);
  const parts = reservationDatePartsFormatter.formatToParts(date);
  const item = (type: string) => parts.find(part => part.type === type)?.value.replace('.', '').toUpperCase() ?? '';
  return { weekday: item('weekday'), day: item('day'), month: item('month') };
}

export function formatDateTimeBR(value: string | Date): string {
  return `${formatDateBR(value)} às ${formatTimeBR(value)}`;
}

export function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BRAZIL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const item = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${item('year')}-${item('month')}-${item('day')}`;
}

export function parseDateBR(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  return formatDateBR(iso) === value ? iso : null;
}

export const reservationStatusLabel: Record<string, string> = {
  pending: 'Aguardando confirmação', confirmed: 'Confirmada', cancelled: 'Cancelada', completed: 'Concluída', no_show: 'Não compareceu', blocked: 'Bloqueado', available: 'Disponível',
};

export const weekdaysBR = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
