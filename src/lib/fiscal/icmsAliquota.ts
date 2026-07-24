// Sugestão de alíquota de ICMS para prestação de serviço de transporte (CT-e).
// Interestadual: 7% quando origem em S/SE (exceto ES) para destinos em N/NE/CO/ES; caso contrário 12%.
// Intraestadual: valor típico por UF (fallback 12%).

const ORIGIN_SUL_SUDESTE_EXC_ES = new Set(['SP', 'RJ', 'MG', 'RS', 'SC', 'PR']);
const DEST_N_NE_CO_ES = new Set([
  'AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO',
  'AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE',
  'DF', 'GO', 'MT', 'MS',
  'ES',
]);

const INTRA_UF: Record<string, number> = {
  AC: 19, AL: 19, AP: 18, AM: 20, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19,
  MA: 22, MT: 17, MS: 17, MG: 18, PA: 19, PB: 20, PR: 19.5, PE: 20.5, PI: 21,
  RJ: 22, RN: 20, RS: 17, RO: 19.5, RR: 20, SC: 17, SP: 12, SE: 22, TO: 20,
};

export function suggestIcmsAliquota(originUf?: string | null, destUf?: string | null): number {
  const o = (originUf || '').toUpperCase();
  const d = (destUf || '').toUpperCase();
  if (!o || !d) return 12;
  if (o === d) return INTRA_UF[o] ?? 12;
  if (ORIGIN_SUL_SUDESTE_EXC_ES.has(o) && DEST_N_NE_CO_ES.has(d)) return 7;
  return 12;
}

/** Aplica isenção quando CST for 40/41/51. */
export function icmsIsentoByCst(cst?: string | null): boolean {
  return cst === '40' || cst === '41' || cst === '51';
}