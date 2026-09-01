export function normalizeNfeAccessKey(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function calculateNfeAccessKeyCheckDigit(firstFortyThreeDigits: string): number | null {
  const digits = normalizeNfeAccessKey(firstFortyThreeDigits);
  if (digits.length !== 43) return null;

  let weight = 2;
  let sum = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }

  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
}

export function isValidNfeAccessKey(value: unknown): boolean {
  const digits = normalizeNfeAccessKey(value);
  if (digits.length !== 44) return false;
  if (/^0{44}$/.test(digits)) return false;
  const expected = calculateNfeAccessKeyCheckDigit(digits.slice(0, 43));
  return expected !== null && expected === Number(digits[43]);
}
