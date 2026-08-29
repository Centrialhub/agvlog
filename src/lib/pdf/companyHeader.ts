import type jsPDF from 'jspdf';

export interface CompanyPdfInfo {
  name?: string;         // resolved display name (legal or trade)
  legalName?: string;
  tradeName?: string;
  taxId?: string;
  stateRegistration?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoDataUrl?: string;
}

/** Constrói um `CompanyPdfInfo` a partir do perfil salvo em tenants.settings.company. */
export function toCompanyPdfInfo(
  profile: {
    legal_name?: string;
    trade_name?: string;
    tax_id?: string;
    state_registration?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    email?: string;
    website?: string;
    logo_data_url?: string;
  } | null | undefined,
  fallbackName?: string,
): CompanyPdfInfo {
  const p = profile || {};
  const name = p.legal_name || p.trade_name || fallbackName || '';
  return {
    name,
    legalName: p.legal_name,
    tradeName: p.trade_name,
    taxId: p.tax_id,
    stateRegistration: p.state_registration,
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    phone: p.phone,
    email: p.email,
    website: p.website,
    logoDataUrl: p.logo_data_url,
  };
}

export function companyLocationLine(info?: CompanyPdfInfo | null): string {
  if (!info) return '';
  const cityState = [info.city, info.state].filter(Boolean).join('/');
  return [info.address, cityState, info.zip ? `CEP ${info.zip}` : ''].filter(Boolean).join(' - ');
}

export function companyContactLine(info?: CompanyPdfInfo | null): string {
  if (!info) return '';
  return [info.phone, info.email, info.website].filter(Boolean).join(' • ');
}

/**
 * Desenha um cabeçalho corporativo padrão (logo + nome + CNPJ + endereço + contato)
 * no topo do documento. Retorna a coordenada Y final abaixo do cabeçalho.
 */
export function drawCompanyHeader(
  doc: jsPDF,
  info: CompanyPdfInfo | null | undefined,
  opts: { x?: number; y?: number; maxWidth?: number; showContact?: boolean } = {},
): number {
  if (!info) return opts.y ?? 14;
  const x = opts.x ?? 14;
  const y = opts.y ?? 12;
  const maxWidth = opts.maxWidth ?? 180;

  let textX = x;
  if (info.logoDataUrl) {
    try {
      const fmt = info.logoDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(info.logoDataUrl, fmt, x, y - 2, 22, 16, undefined, 'FAST');
      textX = x + 26;
    } catch { /* ignore */ }
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  const displayName = info.name || info.legalName || info.tradeName || '';
  if (displayName) doc.text(displayName, textX, y + 3, { maxWidth });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80);
  const parts: string[] = [];
  if (info.taxId) parts.push(`CNPJ ${info.taxId}`);
  if (info.stateRegistration) parts.push(`IE ${info.stateRegistration}`);
  const line1 = parts.join('  •  ');
  const line2 = companyLocationLine(info);
  const line3 = opts.showContact === false ? '' : companyContactLine(info);

  let ly = y + 7;
  for (const line of [line1, line2, line3]) {
    if (!line) continue;
    doc.text(line, textX, ly, { maxWidth });
    ly += 4;
  }
  doc.setTextColor(0);
  doc.setFontSize(10);
  return Math.max(ly + 2, y + 18);
}
