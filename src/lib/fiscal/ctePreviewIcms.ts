import { computeIcmsAmounts } from '@/lib/fiscal/cteBuilder';

/** Recalcula base/valor do ICMS respeitando o regime embutido (por dentro). */
export function recalcIcms(
  freight: number,
  aliq: number,
  embutido: boolean,
  isento: boolean,
  providedBase?: number | null,
): { base: number; valor: number } {
  return computeIcmsAmounts({
    freight: freight || 0,
    aliq: Number(aliq) || 0,
    embutido,
    isento,
    providedBase: providedBase ?? null,
  });
}
