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