import type { ReturnSheet } from '@/hooks/useOccurrenceReturnSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtDateSafe } from '@/lib/utils/formatDate';

interface Props {
  sheet: ReturnSheet;
}

function fmtDate(v: unknown): string {
  return fmtDateSafe(v);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function display(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

export function OccurrenceReturnSheetPreview({ sheet }: Props) {
  const occ = sheet.occurrence_snapshot ?? {};
  const company = sheet.company_snapshot ?? {};
  const load = asRecord(company.load);
  const invoices = sheet.invoice_snapshot ?? [];
  const products = sheet.product_snapshot ?? [];

  return (
    <Card className="print:shadow-none">
      <CardContent className="p-6 space-y-4 text-sm">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <div className="text-base font-bold">
              {display(company.name) === '—' ? 'AGV DISTRIBUIÇÃO E LOGÍSTICA LTDA' : display(company.name)}
            </div>
            <div className="text-xs text-muted-foreground">Folha de Devolução — SAC {sheet.sac_number || sheet.sheet_number}</div>
          </div>
          <Badge variant="outline">v{sheet.version} · {sheet.status}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <div><b>Data Abertura:</b> {fmtDate(occ.occurrence_date)}</div>
          <div><b>Motorista:</b> {display(load.driver_name)}</div>
          <div><b>Data Encerramento:</b> {fmtDate(occ.closed_at || occ.resolved_at)}</div>
          <div><b>Placa:</b> {display(load.vehicle_plate) !== '—' ? display(load.vehicle_plate) : display(load.trailer_plate)}</div>
          <div><b>Romaneio:</b> {display(load.load_number)}</div>
          <div><b>Senha:</b> {display(occ.password_or_authorization)}</div>
        </div>

        <div className="border rounded p-3 space-y-1">
          <div className="font-semibold mb-1">Ocorrência</div>
          <div><b>Assunto:</b> {String(occ.occurrence_type || '—').toUpperCase()}</div>
          <div><b>Ocorrência:</b> {String(occ.occurrence_reason || '—').toUpperCase()}</div>
          <div><b>Solução:</b> {String(occ.resolution_type || '—').toUpperCase()}</div>
          <div><b>Observação:</b> {display(occ.resolution_notes) !== '—' ? display(occ.resolution_notes) : display(occ.occurrence_description)}</div>
        </div>

        <div>
          <div className="font-semibold mb-1">Notas Fiscais</div>
          <table className="w-full text-xs border">
            <thead className="bg-muted">
              <tr><th className="p-1 text-left">Nº Nota</th><th className="p-1 text-left">Fornecedor</th><th className="p-1 text-left">Cliente</th><th className="p-1 text-left">Data Emissão</th></tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">{display(inv.invoice_number)}</td>
                  <td className="p-1">{display(inv.remitter)}</td>
                  <td className="p-1">{display(inv.recipient)}</td>
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
              {products.map((p, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">{display(p.invoice_number)}</td>
                  <td className="p-1">{i + 1}</td>
                  <td className="p-1">{display(p.product_code)}</td>
                  <td className="p-1">{display(p.product_description)}</td>
                  <td className="p-1">{display(p.unit)}</td>
                  <td className="p-1">{display(p.quantity ?? p.quantity_text)}</td>
                  <td className="p-1">{display(p.quantity_problem ?? p.quantity)}</td>
                  <td className="p-1">{display(p.return_type)}</td>
                  <td className="p-1">{display(p.notes)}</td>
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
