/**
 * Formatação segura de datas para relatórios.
 *
 * Motivo: `new Date('YYYY-MM-DD')` é interpretado como UTC 00:00.
 * Em fusos negativos (Brasil UTC-3) isso mostra o dia anterior.
 * Estas funções tratam DATE puro localmente e mantêm timestamps ISO como antes.
 */

function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export const APP_TIME_ZONE = 'America/Sao_Paulo';

function zonedParts(value: Date, includeTime = false): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  });
  return Object.fromEntries(
    formatter.formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
}

function zonedMidnightUtc(year: number, month: number, day: number): Date {
  const wanted = Date.UTC(year, month - 1, day);
  let instant = wanted;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(instant), true);
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    instant += wanted - observed;
  }
  return new Date(instant);
}

/** Limites UTC [início, fim) do dia civil de São Paulo, inclusive em mudanças de fuso. */
export function localDateUtcRange(dateOnly: string): { from: string; toExclusive: string } {
  if (!isDateOnly(dateOnly)) throw new Error('Data local inválida');
  const [year, month, day] = dateOnly.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    from: zonedMidnightUtc(year, month, day).toISOString(),
    toExclusive: zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()).toISOString(),
  };
}

/** Valor de input date para o calendário operacional de São Paulo. */
export function localDateInputValue(value: Date = new Date()): string {
  const { year, month, day } = zonedParts(value);
  return `${year}-${month}-${day}`;
}

/** Valor de input datetime-local sem converter o relógio local para UTC. */
export function localDateTimeInputValue(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const { year, month, day, hour, minute } = zonedParts(date, true);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** Formata um valor como data (dd/MM/yyyy) em pt-BR sem sofrer com fuso. */
export function fmtDateSafe(v: unknown, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  const s = String(v).trim();
  if (isDateOnly(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (!isNaN(dt.getTime())) return dt.toLocaleDateString('pt-BR');
    return s;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('pt-BR');
}

/** Formata como data e hora em pt-BR; para DATE puro devolve só a data. */
export function fmtDateTimeSafe(v: unknown, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  const s = String(v).trim();
  if (isDateOnly(s)) return fmtDateSafe(s, fallback);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('pt-BR');
}
