// Máscaras e validações reutilizáveis para inputs (CPF, CNPJ, datas e valores).
// Centralizado para garantir comportamento consistente em todo o app.

// ---------- CPF ----------
export const maskCPF = (v: string): string => {
  const d = (v || '').replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

export const isValidCPF = (v: string): boolean => {
  const c = (v || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (base: number) => {
    let sum = 0;
    for (let i = 0; i < base; i++) sum += parseInt(c[i]) * (base + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(c[9]) && calc(10) === parseInt(c[10]);
};

// ---------- CNPJ ----------
export const maskCNPJ = (v: string): string => {
  const d = (v || '').replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

export const isValidCNPJ = (v: string): boolean => {
  const c = (v || '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: number) => {
    const weights =
      base === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base; i++) sum += parseInt(c[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(c[12]) && calc(13) === parseInt(c[13]);
};

// CPF ou CNPJ (auto)
export const maskCpfCnpj = (v: string): string => {
  const d = (v || '').replace(/\D/g, '');
  return d.length <= 11 ? maskCPF(d) : maskCNPJ(d);
};
export const isValidCpfCnpj = (v: string): boolean => {
  const d = (v || '').replace(/\D/g, '');
  return d.length <= 11 ? isValidCPF(d) : isValidCNPJ(d);
};

// ---------- Datas ----------
// Bloqueia datas absurdas (antes de 2000 / muito no futuro).
export const isReasonableDate = (iso?: string | null, maxFutureDays = 7): boolean => {
  if (!iso) return true; // vazio é permitido (não obrigatório aqui)
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const min = new Date('2000-01-01').getTime();
  const max = Date.now() + maxFutureDays * 24 * 60 * 60 * 1000;
  return d.getTime() >= min && d.getTime() <= max;
};

// ---------- Valores monetários (BRL) ----------
// Mantém apenas dígitos e formata como R$ 0,00 enquanto o usuário digita.
export const maskCurrencyBRL = (v: string): string => {
  const digits = (v || '').replace(/\D/g, '').slice(0, 13); // até ~99 bilhões
  if (!digits) return '';
  const n = parseInt(digits, 10) / 100;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// Converte string mascarada/digitada para número (centavos -> reais).
export const parseCurrencyBRL = (v: string): number => {
  if (!v) return 0;
  const digits = String(v).replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
};

export const isValidCurrency = (v: string | number, { min = 0, max = 1e12 } = {}): boolean => {
  const n = typeof v === 'number' ? v : parseCurrencyBRL(v);
  return Number.isFinite(n) && n >= min && n <= max;
};