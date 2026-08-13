/**
 * Normalização de dados de endereço/identificação para payloads fiscais
 * (NFS-e e CT-e). Prefeituras rejeitam a nota quando o CEP não tem 8 dígitos
 * reais, quando a UF vem escrita por extenso ou quando o código IBGE do
 * município não é enviado. Aqui centralizamos essas regras.
 */
export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
const UF_BY_NAME = {
    ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE',
    'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA',
    'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', 'MINAS GERAIS': 'MG', PARA: 'PA',
    PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI', 'RIO DE JANEIRO': 'RJ',
    'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO', RORAIMA: 'RR',
    'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE', TOCANTINS: 'TO',
};
const VALID_UF = new Set(Object.values(UF_BY_NAME));
/** Retorna a sigla de 2 letras da UF, ou null quando não for possível deduzir. */
export function normalizeUf(v) {
    const raw = String(v ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase().trim();
    if (!raw)
        return null;
    if (raw.length === 2 && VALID_UF.has(raw))
        return raw;
    const byName = UF_BY_NAME[raw.replace(/\s+/g, ' ')];
    return byName || null;
}
/**
 * CEP em exatamente 8 dígitos. Retorna null quando não houver CEP utilizável —
 * NUNCA inventamos "00000000", porque o provedor valida o CEP contra o
 * município e rejeita a nota.
 */
export function normalizeCep(v) {
    const d = onlyDigits(v);
    if (d.length < 7 || d.length > 8)
        return null;
    const cep = d.padStart(8, '0');
    if (/^0{8}$/.test(cep))
        return null;
    return cep;
}
/** Código IBGE do município: exatamente 7 dígitos, senão null. */
export function normalizeIbgeCity(v) {
    const d = onlyDigits(v);
    return d.length === 7 ? d : null;
}
/** Nome de município: sem código numérico, sem UF colada, comprimento limitado. */
export function normalizeCityName(v) {
    const raw = String(v ?? '').trim();
    if (!raw)
        return null;
    if (/^\d+$/.test(raw))
        return null; // era um código, não um nome
    return raw.replace(/\s*[-/]\s*[A-Z]{2}$/i, '').slice(0, 60);
}
/** CPF (11) ou CNPJ (14). Retorna null para qualquer outro tamanho. */
export function normalizeCpfCnpj(v) {
    const d = onlyDigits(v);
    return d.length === 11 || d.length === 14 ? d : null;
}
/** Telefone: 10 ou 11 dígitos (sem DDI). */
export function normalizePhone(v) {
    let d = onlyDigits(v);
    if (d.startsWith('55') && d.length > 11)
        d = d.slice(2);
    return d.length === 10 || d.length === 11 ? d : null;
}
/** Texto livre para campos fiscais: colapsa espaços e limita o tamanho. */
export function fiscalText(v, max) {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
}
/** Arredonda para 2 casas evitando erros de ponto flutuante. */
export function money(v) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100) / 100;
}
export function isValidEmail(v) {
    const s = String(v ?? '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}
