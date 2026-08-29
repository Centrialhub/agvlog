import { normalizeTaxId } from './fiscalIdentity';

/**
 * Normaliza um nome de empresa para comparação, removendo sufixos comuns
 * e caracteres especiais.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+(LTDA|S\/A|SA|ME|EPP|EIRELI|LIMITADA|SERVICOS|COMERCIO|E\s+PARTICIPACOES)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface FiscalClientMatchCandidate {
  tax_id?: string | null;
  company_name?: string | null;
  legal_name?: string | null;
  address_city?: string | null;
}

/**
 * Verifica se um destinatário da NF-e (xml) corresponde a um cliente cadastrado,
 * considerando CNPJ e normalização de endereço/filiais.
 */
export function matchClientForFiscalDoc<T extends FiscalClientMatchCandidate>(
  recipient: {
    cnpj: string | null;
    name: string | null;
    city: string | null;
    state: string | null;
    address?: string | null;
    zip?: string | null;
  },
  clients: readonly T[],
): T | null {
  const cnpj = normalizeTaxId(recipient.cnpj);
  
  // 1. Busca por CNPJ exato (Método mais seguro)
  if (cnpj) {
    const byCnpj = clients.filter(c => normalizeTaxId(c.tax_id) === cnpj);
    
    if (byCnpj.length === 1) return byCnpj[0];
    
    // Se houver múltiplas filiais com o mesmo CNPJ (raro mas possível em alguns ERPs se o tax_id for só raiz, 
    // embora no Brasil CNPJ mude nos últimos 4 dígitos para filiais)
    if (byCnpj.length > 1) {
      const city = (recipient.city || '').toUpperCase().trim();
      const byCity = byCnpj.find(c => (c.address_city || '').toUpperCase().trim() === city);
      if (byCity) return byCity;
      return byCnpj[0]; // Fallback para a primeira
    }
  }

  // 2. Busca por Nome + Cidade (Congruência de endereço solicitada pelo usuário)
  const normName = normalizeCompanyName(recipient.name);
  if (normName) {
    const city = (recipient.city || '').toUpperCase().trim();
    
    // Busca clientes que batem o nome normalizado e a cidade
    const candidates = clients.filter(c => 
      normalizeCompanyName(c.company_name) === normName || 
      normalizeCompanyName(c.legal_name) === normName
    );

    if (candidates.length > 0) {
      const byCity = candidates.find(c => (c.address_city || '').toUpperCase().trim() === city);
      if (byCity) return byCity;
      
      // Se não achou por cidade, mas só tem um cliente com esse nome, retorna ele
      if (candidates.length === 1) return candidates[0];
    }
  }

  return null;
}
