export interface NormalizedCargoWeight {
  value: string;
  raw: string;
  rounded: boolean;
}

/** Round the decimal received from the API, half up, without binary multiplication. */
export function normalizeCargoWeightKg(weight: number): NormalizedCargoWeight {
  if (!Number.isFinite(weight) || weight < 0) throw new Error('Peso inválido para conferência.');
  const raw = String(weight);
  const [coefficient, exponentText] = raw.toLowerCase().split('e');
  const [integer, fraction = ''] = coefficient.split('.');
  const digits = BigInt(`${integer}${fraction}`);
  const scale = fraction.length - Number(exponentText ?? 0);
  let cents: bigint;
  let rounded = false;
  if (scale <= 2) {
    cents = digits * 10n ** BigInt(2 - scale);
  } else {
    const divisor = 10n ** BigInt(scale - 2);
    const remainder = digits % divisor;
    cents = digits / divisor + (remainder * 2n >= divisor ? 1n : 0n);
    rounded = remainder !== 0n;
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Peso excede a precisão segura de duas casas para conferência.');
  }
  const value = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  // The existing JSON payload uses numbers; reject a cent that would disappear there.
  const [payloadInteger, payloadFraction = ''] = String(Number(value)).split('.');
  if (payloadFraction.length > 2 || BigInt(`${payloadInteger}${payloadFraction.padEnd(2, '0')}`) !== cents) {
    throw new Error('Peso não pode ser representado com duas casas para conferência.');
  }
  return { value, raw, rounded };
}
