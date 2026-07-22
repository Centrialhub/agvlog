/**
 * Chave canônica de cidade para agrupamento/comparação.
 * Remove acentos, normaliza espaços e uppercases — assim "Janaúba" e "Janauba"
 * caem no mesmo grupo. Não altere o valor exibido; use apenas como chave.
 */
export function normalizeCityKey(city: string | null | undefined): string {
  const raw = (city ?? '').toString();
  if (!raw.trim()) return 'SEM CIDADE';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Variante bruta da normalização: mesma canonicalização (NFD + strip de acentos + uppercase + colapso de espaços),
 * mas retorna string vazia para entrada vazia (em vez de 'SEM CIDADE').
 * Use para comparações onde vazio precisa ser distinguível.
 */
export function normalizeCity(city: string | null | undefined): string {
  const raw = (city ?? '').toString();
  if (!raw.trim()) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}