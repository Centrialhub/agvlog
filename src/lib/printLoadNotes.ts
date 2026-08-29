// Gera uma janela imprimível (Salvar como PDF) com o relatório de Notas Fiscais da carga.
// Não depende de libs externas — usa a própria caixa de impressão do navegador.

const PAYMENT_LABELS: Record<string, string> = {
  a_vista: 'À Vista',
  a_prazo: 'A Prazo',
  boleto: 'Boleto',
  pix: 'PIX',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão Crédito',
  cartao_debito: 'Cartão Débito',
  cheque: 'Cheque',
  faturado: 'Faturado',
};

const fmtMoney = (n?: number | null) =>
  n == null ? 'R$ 0,00' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

interface PrintableLoad {
  load_number?: string | null;
  status?: string | null;
  driver_name?: string | null;
  vehicle_plate?: string | null;
}

interface DeliveryMetadata {
  ne?: boolean;
  rec_canhoto?: boolean;
  payment_method?: string | null;
  delivery_at?: string | null;
  ne_at?: string | null;
  ne_reason?: string | null;
  oco_01?: string | null;
  oco_02?: string | null;
  resp_oco?: string | null;
}

interface PrintableLoadDocument {
  document_type?: string | null;
  value?: number | null;
  status?: string | null;
  delivery_meta?: DeliveryMetadata | null;
  invoice_number?: string | null;
  reference_number?: string | null;
  remitter?: string | null;
  recipient?: string | null;
  recipient_city?: string | null;
  recipient_state?: string | null;
}

export function printLoadNotesReport(load: PrintableLoad, documents: PrintableLoadDocument[]) {
  const docs = (documents || []).filter((document) => document.document_type === 'inbound');
  const total = docs.reduce((sum, document) => sum + Number(document.value || 0), 0);
  const delivered = docs.filter((document) => document.status === 'delivered').length;
  const notDelivered = docs.filter(
    (document) => document.status === 'not_delivered' || document.delivery_meta?.ne,
  ).length;
  const pending = docs.length - delivered - notDelivered;

  const rows = docs
    .map((d) => {
      const m = d.delivery_meta || {};
      const isDelivered = d.status === 'delivered';
      const isNotDelivered = d.status === 'not_delivered' || m.ne;
      const statusLabel = isNotDelivered ? 'Não Entregue' : isDelivered ? 'Entregue' : 'Pendente';
      const statusClass = isNotDelivered ? 'st-ne' : isDelivered ? 'st-ok' : 'st-pd';
      const pgto = m.payment_method ? PAYMENT_LABELS[m.payment_method] || m.payment_method : '—';
      const cidade = `${d.recipient_city || '—'}${d.recipient_state ? '/' + d.recipient_state : ''}`;
      const dtEntrega = fmtDateTime(m.delivery_at || m.ne_at);
      const obs = isNotDelivered && m.ne_reason ? `<div class="obs">Motivo: ${esc(m.ne_reason)}</div>` : '';
      return `
        <tr>
          <td class="ck">${m.rec_canhoto ? '☑' : '☐'}</td>
          <td>${esc(d.invoice_number || '—')}</td>
          <td>${esc(d.reference_number || '0')}</td>
          <td><span class="badge ${statusClass}">${statusLabel}</span>${obs}</td>
          <td class="trunc">${esc(d.remitter || '—')}</td>
          <td class="trunc">${esc(d.recipient || '—')}</td>
          <td>${esc(cidade)}</td>
          <td class="num">${fmtMoney(Number(d.value || 0))}</td>
          <td>${esc(pgto)}</td>
          <td>${esc(m.oco_01 || '—')}</td>
          <td>${esc(m.oco_02 || '—')}</td>
          <td>${esc(m.resp_oco || '—')}</td>
          <td>${dtEntrega}</td>
        </tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Notas Fiscais — Carga ${esc(load.load_number || '')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 16px; font-size: 11px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 11px; margin-bottom: 10px; }
  .meta strong { color: #111; }
  .summary { display: flex; gap: 12px; margin: 8px 0 14px; flex-wrap: wrap; }
  .card { border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; font-size: 11px; }
  .card b { display:block; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #ccc; padding: 4px 5px; vertical-align: top; }
  th { background: #f3f4f6; text-align: left; font-size: 9.5px; text-transform: uppercase; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.ck { text-align: center; font-size: 13px; }
  td.trunc { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 9px; font-weight: 600; }
  .st-ok { background: #dcfce7; color: #166534; }
  .st-ne { background: #fee2e2; color: #991b1b; }
  .st-pd { background: #f1f5f9; color: #475569; }
  .obs { font-size: 9px; color: #991b1b; margin-top: 2px; }
  tfoot td { font-weight: 700; background: #f9fafb; }
  .sign { margin-top: 36px; display: flex; gap: 60px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 10px; }
  .foot { margin-top: 12px; color: #777; font-size: 9px; text-align: right; }
  @page { size: A4 landscape; margin: 10mm; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>Relatório de Notas Fiscais</h1>
  <div class="meta">
    <strong>Carga:</strong> ${esc(load.load_number || '—')} &nbsp;·&nbsp;
    <strong>Status:</strong> ${esc(load.status || '—')} &nbsp;·&nbsp;
    <strong>Motorista:</strong> ${esc(load.driver_name || '—')} &nbsp;·&nbsp;
    <strong>Veículo:</strong> ${esc(load.vehicle_plate || '—')}
  </div>
  <div class="summary">
    <div class="card"><b>${docs.length}</b>Total notas</div>
    <div class="card"><b>${delivered}</b>Entregues</div>
    <div class="card"><b>${notDelivered}</b>Não entregues</div>
    <div class="card"><b>${pending}</b>Pendentes</div>
    <div class="card"><b>${fmtMoney(total)}</b>Valor total</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Canh.</th><th>Nº NFS</th><th>NUMREF</th><th>Situação</th>
        <th>Fornecedor</th><th>Destinatário</th><th>Município</th>
        <th class="num">Vl NFS</th><th>Forma Pgto</th>
        <th>Oco 01</th><th>Oco 02</th><th>Resp. Oco</th><th>Dt. Entrega/Oco</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="13" style="text-align:center;color:#777;padding:20px">Nenhuma nota fiscal vinculada.</td></tr>`}</tbody>
    ${docs.length ? `<tfoot><tr><td colspan="7" style="text-align:right">Total:</td><td class="num">${fmtMoney(total)}</td><td colspan="5"></td></tr></tfoot>` : ''}
  </table>
  <div class="sign">
    <div>Conferente</div>
    <div>Motorista</div>
    <div>Recebedor / Carimbo</div>
  </div>
  <div class="foot">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
  <script>window.onload = () => { setTimeout(() => window.print(), 250); };</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) {
    alert('Permita pop-ups para gerar o relatório.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
