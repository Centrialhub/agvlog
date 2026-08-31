/** MG check digits: https://www.sintegra.gov.br/Cad_Estados/cad_MG.html */
function validMinasGeraisIe(ie: string): boolean {
  if (!/^\d{13}$/.test(ie) || /^0+$/.test(ie)) return false;
  const base = ie.slice(0, 3) + '0' + ie.slice(3, 11);
  const sum = [...base].reduce((total, digit, i) => {
    const product = Number(digit) * (i % 2 + 1);
    return total + Math.floor(product / 10) + product % 10;
  }, 0);
  const first = (10 - sum % 10) % 10;
  const weights = [3, 2, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const remainder = [...ie.slice(0, 12)].reduce((total, digit, i) => total + Number(digit) * weights[i], 0) % 11;
  const second = remainder < 2 ? 0 : 11 - remainder;
  return first === Number(ie[11]) && second === Number(ie[12]);
}

/**
 * Return a correction only for missing leading zeros with both MG check digits valid.
 * Does not infer IE, repair OCR substitutions, validate ownership, or change other UFs.
 */
export function restoreStateRegistrationLeadingZeros(raw?: string | null, uf?: string | null): string | null {
  if ((uf || '').trim().toUpperCase() !== 'MG' || !raw || !/^[\d\s./-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length >= 13) return null;
  const padded = digits.padStart(13, '0');
  return validMinasGeraisIe(padded) ? padded : null;
}
