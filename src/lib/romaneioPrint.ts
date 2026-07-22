// Shared romaneio HTML print utility — must stay visually identical across:
// - Ingestion / Grouping (analise primária)
// - Route Planning (roteirização)
// - Loads (reimpressão)

import { normalizeCityKey } from '@/lib/utils/normalizeCity';

export type RomaneioDoc = {
  city: string;
  state: string;
  remetente: string;
  destinatario: string;
  bairro: string;
  nfNumber: string;
  emissao: string;
  valor: number;
  peso: number;
  volumes: number;
};

export type RomaneioRoute = {
  routeName: string;
  vehicleInfo?: string;
  driverInfo?: string;
  docs: RomaneioDoc[];
};

const printStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; padding: 8mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: landscape; margin: 6mm; }
  h1 { font-size: 15px; font-weight: 900; margin-bottom: 2px; border-bottom: 3px solid #000; padding-bottom: 4px; text-transform: uppercase; }
  .subtitle { font-size: 10px; color: #333; margin-bottom: 10px; font-weight: 600; }
  .city-section { margin-bottom: 12px; page-break-inside: avoid; }
  .city-header { background: #d9d9d9; padding: 5px 8px; font-size: 12px; font-weight: 900; color: #000; border: 2px solid #000; display: flex; justify-content: space-between; align-items: center; }
  .city-meta { display: flex; gap: 20px; padding: 3px 8px; background: #eee; border: 1px solid #000; border-top: none; font-size: 10px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th { text-align: left; background: #e0e0e0; padding: 4px 5px; border: 1.5px solid #000; font-weight: 900; font-size: 9px; white-space: nowrap; color: #000; text-transform: uppercase; }
  td { padding: 3px 5px; border: 1px solid #000; color: #000; font-weight: 600; }
  tr:nth-child(even) td { background: #f5f5f5; }
  .right { text-align: right; }
  .center { text-align: center; }
  .total-row td { background: #d9d9d9 !important; font-weight: 900; font-size: 10px; border-top: 2.5px solid #000; }
  .grand-totals { margin-top: 14px; padding: 8px 10px; background: #000; color: #fff; font-size: 12px; font-weight: 900; border: 3px solid #000; display: flex; gap: 20px; flex-wrap: wrap; }
  .grand-totals span { white-space: nowrap; }
  .footer { margin-top: 10px; text-align: center; font-size: 8px; color: #666; border-top: 1px solid #999; padding-top: 4px; }
  .route-break { page-break-before: always; }
  .assign-info { font-size: 11px; color: #000; background: #e8f5e9; padding: 4px 8px; border: 1px solid #000; margin-bottom: 8px; font-weight: 700; }
  @media print { body { padding: 5mm; } .city-section { page-break-inside: avoid; } }
`;

const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const fmtN = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

const sortByRecipient = (docs: RomaneioDoc[]) => [...docs].sort((a, b) =>
  collator.compare(a.destinatario || '—', b.destinatario || '—') ||
  collator.compare(a.bairro || '—', b.bairro || '—') ||
  collator.compare(a.nfNumber || '—', b.nfNumber || '—')
);

function buildCityBlocks(docs: RomaneioDoc[]) {
  // Group by normalized city key (accent-insensitive) so "Janaúba" and "Janauba"
  // merge; preserve the first-seen display spelling for the header.
  const cityMap = new Map<string, RomaneioDoc[]>();
  const cityDisplay = new Map<string, string>();
  sortByRecipient(docs).forEach(d => {
    const key = normalizeCityKey(d.city);
    if (!cityMap.has(key)) {
      cityMap.set(key, []);
      cityDisplay.set(key, (d.city || 'SEM CIDADE').trim().toUpperCase());
    }
    cityMap.get(key)!.push(d);
  });

  let totalNotas = 0, totalEntregas = 0, totalValor = 0, totalPeso = 0, totalVolumes = 0;
  let html = '';

  Array.from(cityMap.entries()).sort(([a], [b]) => collator.compare(a, b)).forEach(([key, cityDocs]) => {
    const cityName = cityDisplay.get(key) || key;
    const entregas = new Set(cityDocs.map(d => d.destinatario)).size;
    const notas = cityDocs.length;
    const valor = cityDocs.reduce((s, d) => s + d.valor, 0);
    const peso = cityDocs.reduce((s, d) => s + d.peso, 0);
    const volumes = cityDocs.reduce((s, d) => s + d.volumes, 0);
    totalNotas += notas; totalEntregas += entregas; totalValor += valor; totalPeso += peso; totalVolumes += volumes;

    const state = cityDocs[0]?.state || '';
    const rows = cityDocs.map(d => `
      <tr>
        <td>${d.remetente}</td>
        <td>${d.destinatario}</td>
        <td>${d.city}</td>
        <td class="center">${d.bairro}</td>
        <td class="center">${d.nfNumber}</td>
        <td class="center">${d.emissao}</td>
        <td class="right">${fmt(d.valor)}</td>
        <td class="right">${fmtN(d.peso)}</td>
        <td class="center">${d.volumes}</td>
      </tr>`).join('');

    html += `
      <div class="city-section">
        <div class="city-header">
          <span>Cidade: ${cityName}${state ? ' - ' + state : ''}</span>
        </div>
        <div class="city-meta">
          <span>Qtd Entregas: ${entregas}</span>
          <span>Qtd Notas: ${notas}</span>
        </div>
        <table>
          <thead><tr>
            <th>Remetente</th><th>Destinatário</th><th>Cidade</th><th class="center">Bairro</th>
            <th class="center">Nº Nota</th><th class="center">Emissão</th>
            <th class="right">Vlr. Nota</th><th class="right">Peso</th><th class="center">Volumes</th>
          </tr></thead>
          <tbody>
            ${rows}
            <tr class="total-row">
              <td colspan="5">Total Cidade:</td>
              <td></td>
              <td class="right">${fmt(valor)}</td>
              <td class="right">${fmtN(peso)}</td>
              <td class="center">${volumes}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  });

  return { html, totalNotas, totalEntregas, totalValor, totalPeso, totalVolumes };
}

/** Print one or more routes — each route becomes its own page (matches "Análise primária"). */
export function printRomaneioRoutes(routes: RomaneioRoute[], title = 'Romaneio') {
  const pages: string[] = [];
  routes.forEach((r, i) => {
    if (!r.docs.length) return;
    const { html, totalNotas, totalEntregas, totalValor, totalPeso, totalVolumes } = buildCityBlocks(r.docs);
    const assignLine = (r.vehicleInfo || r.driverInfo)
      ? `<div class="assign-info">${r.vehicleInfo || ''}${r.driverInfo ? (r.vehicleInfo ? ' | ' : '') + r.driverInfo : ''}</div>`
      : '';

    pages.push(`
      <div class="${i > 0 ? 'route-break' : ''}">
        <h1>ROTA: ${(r.routeName || '—').toUpperCase()}</h1>
        <div class="subtitle">${new Date().toLocaleDateString('pt-BR')} | Carga ${i + 1} de ${routes.length}</div>
        ${assignLine}
        ${html}
        <div class="grand-totals">
          <span>TOTAL ROTA</span>
          <span>Qtd Total Entregas: ${totalEntregas}</span>
          <span>Qtd Total Notas: ${totalNotas}</span>
          <span>Valor: ${fmt(totalValor)}</span>
          <span>Peso: ${fmtN(totalPeso)}</span>
          <span>Volumes: ${totalVolumes}</span>
        </div>
        <div class="footer">Gerado em ${new Date().toLocaleString('pt-BR')} — Sistema de Impressão Logística</div>
      </div>`);
  });

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<html><head><title>${title}</title><style>${printStyles}</style></head><body>${pages.join('')}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
