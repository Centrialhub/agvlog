export const DEFAULT_TRANSPORT_NFSE_NATIONAL_SERVICE_CODE = '160201';

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Converts the transport codes used by the legacy municipal payload to the
 * six-digit national NFS-e service code required by the current Hub contract.
 */
export function resolveNFSeNationalServiceCode(...values: unknown[]): string {
  const codes = values.map(digits);
  const explicitNationalCode = codes.find(code => /^\d{6}$/.test(code));
  if (explicitNationalCode) return explicitNationalCode;
  for (const code of codes) {
    if (code === '2010' || code === '1602') {
      return DEFAULT_TRANSPORT_NFSE_NATIONAL_SERVICE_CODE;
    }
  }
  return '';
}
