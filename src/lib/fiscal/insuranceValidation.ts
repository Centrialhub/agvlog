/**
 * Validações do bloco de seguro do CT-e (seguradora / apólice / averbação).
 * Usado tanto pelo builder (bloqueio da emissão) quanto pela prévia editável.
 */

export interface InsuranceInput {
  name?: string | null;
  cnpj?: string | null;
  policy?: string | null;
  endorsement?: string | null;
}

export type InsuranceField = 'name' | 'cnpj' | 'policy' | 'endorsement';

export interface InsuranceValidationResult {
  ok: boolean;
  /** Mensagens por campo, prontas para exibição inline. */
  errors: Partial<Record<InsuranceField, string>>;
  /** Lista achatada para o alerta de "campos obrigatórios". */
  messages: string[];
}

export function onlyDigits(value?: string | null): string {
  return (value || '').replace(/\D/g, '');
}

/** Valida CNPJ numérico (14 dígitos) com dígitos verificadores. */
export function isValidCnpj(value?: string | null): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(cnpj[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const result = sum % 11;
    return result < 2 ? 0 : 11 - result;
  };

  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

export function formatCnpj(value?: string | null): string {
  const d = onlyDigits(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Apólice/averbação: alfanumérico (com - . /), 3 a 30 caracteres. */
const DOC_PATTERN = /^[A-Za-z0-9][A-Za-z0-9./-]{2,29}$/;

function validateDocNumber(raw: string, label: string): string | null {
  const value = raw.trim();
  if (!DOC_PATTERN.test(value)) {
    return `${label} inválido — use de 3 a 30 caracteres alfanuméricos (permitidos - . /).`;
  }
  return null;
}

export function validateInsurance(insurer?: InsuranceInput | null): InsuranceValidationResult {
  const errors: Partial<Record<InsuranceField, string>> = {};

  const name = (insurer?.name || '').trim();
  const cnpj = onlyDigits(insurer?.cnpj);
  const policy = (insurer?.policy || '').trim();
  const endorsement = (insurer?.endorsement || '').trim();

  if (!name) {
    errors.name = 'Seguradora é obrigatória.';
  } else if (name.length < 3) {
    errors.name = 'Nome da seguradora deve ter ao menos 3 caracteres.';
  }

  if (!cnpj) {
    errors.cnpj = 'CNPJ da seguradora é obrigatório.';
  } else if (!isValidCnpj(cnpj)) {
    errors.cnpj = 'CNPJ da seguradora inválido — informe 14 dígitos válidos.';
  }

  if (!policy) {
    errors.policy = 'Nº da apólice é obrigatório.';
  } else {
    const err = validateDocNumber(policy, 'Nº da apólice');
    if (err) errors.policy = err;
  }

  if (!endorsement) {
    errors.endorsement = 'Nº da averbação é obrigatório.';
  } else {
    const err = validateDocNumber(endorsement, 'Nº da averbação');
    if (err) errors.endorsement = err;
  }

  const messages = Object.values(errors) as string[];
  return { ok: messages.length === 0, errors, messages };
}
