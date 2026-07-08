import type { ReturnSheet } from '@/hooks/useOccurrenceReturnSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  sheet: ReturnSheet;
}

function fmtDate(v: unknown): string {
  if (!v) return '—';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('pt-BR');
}

export function OccurrenceReturnSheetPreview({ sheet }: Props) {
  const occ = (sheet.occurrence_snapshot ?? {}) as Record<string, any>;
  const load = ((sheet.company_snapshot as any)?.load ?? {}) as Record<string, any>;
  const company = sheet.company_snapshot as Record<string, any>;
  const invoices = sheet.invoice_snapshot ?? [];
  const products = sheet.product_snapshot ?? [];

  return (
    <Card className="print:shadow-none">
      <CardContent className="p-6 space-y-4 text-sm">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <div className="text-base font-bold">
              {company?.name || 'AGV DISTRIBUIÇÃO E LOGÍSTICA LTDA'}
            </div>
            <div className="text-xs text-muted-foreground">Folha de Devolução — SAC {sheet.sac_number || sheet.sheet_number}</div>
          </div>
          <Badge variant="outline">v{sheet.version} · {sheet.status}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <div><b>Data Abertura:</b> {fmtDate(occ.occurrence_date)}</div>
          <div><b>Motorista:</b> {load.driver_name || '—'}</div>
          <div><b>Data Encerramento:</b> {fmtDate(occ.closed_at || occ.resolved_at)}</div>
          <div><b>Placa:</b> {load.vehicle_plate || load.trailer_plate || '—'}</div>
          <div><b>Romaneio:</b> {load.load_number || '—'}</div>
          <div><b>Senha:</b> {occ.password_or_authorization || '—'}</div>
        </div>

        <div className="border rounded p-3 space-y-1">
          <div className="font-semibold mb-1">Ocorrência</div>
          <div><b>Assunto:</b> {String(occ.occurrence_type || '—').toUpperCase()}</div>
          <div><b>Ocorrência:</b> {String(occ.occurrence_reason || '—').toUpperCase()}</div>
          <div><b>Solução:</b> {String(occ.resolution_type || '—').toUpperCase()}</div>
          <div><b>Observação:</b> {occ.resolution_notes || occ.occurrence_description || '—'}</div>
        </div>

        <div>
          <div className="font-semibold mb-1">Notas Fiscais</div>
          <table className="w-full text-xs border">
            <thead className="bg-muted">
              <tr><th className="p-1 text-left">Nº Nota</th><th className="p-1 text-left">Fornecedor</th><th className="p-1 text-left">Cliente</th><th className="p-1 text-left">Data Emissão</th></tr>
            </thead>
            <tbody>
              {invoices.map((inv: any, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">{inv.invoice_number || '—'}</td>
                  <td className="p-1">{inv.remitter || '—'}</td>
                  <td className="p-1">{inv.recipient || '—'}</td>
                  <td className="p-1">{fmtDate(inv.issue_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="font-semibold mb-1">Produtos com problema</div>
          <table className="w-full text-xs border">
            <thead className="bg-muted">
              <tr>
                <th className="p-1 text-left">Nº Nota</th><th className="p-1 text-left">Item</th>
                <th className="p-1 text-left">Código</th><th className="p-1 text-left">Descrição</th>
                <th className="p-1 text-left">UM</th><th className="p-1 text-left">Qtd.</th>
                <th className="p-1 text-left">Qt.Prob.</th><th className="p-1 text-left">Tipo</th>
                <th className="p-1 text-left">Obs.</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p: any, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">{p.invoice_number || '—'}</td>
                  <td className="p-1">{i + 1}</td>
                  <td className="p-1">{p.product_code || '—'}</td>
                  <td className="p-1">{p.product_description || '—'}</td>
                  <td className="p-1">{p.unit || '—'}</td>
                  <td className="p-1">{p.quantity ?? p.quantity_text ?? '—'}</td>
                  <td className="p-1">{p.quantity_problem ?? p.quantity ?? '—'}</td>
                  <td className="p-1">{p.return_type || '—'}</td>
                  <td className="p-1">{p.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pt-6 grid grid-cols-2 gap-6 text-xs">
          <div>
            <div className="border-t pt-2">Assinatura / Recebimento</div>
            {sheet.receiver_name && <div className="mt-1">Recebedor: {sheet.receiver_name}</div>}
          </div>
          <div>
            <div className="border-t pt-2">Data</div>
            {sheet.signed_at && <div className="mt-1">{fmtDate(sheet.signed_at)}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}