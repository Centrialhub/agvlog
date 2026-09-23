import { useEffect, useMemo, useState } from 'react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalReports } from '@/hooks/portal/usePortalReports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Download, TruckIcon, AlertTriangle, ClipboardCheck, Clock } from 'lucide-react';
import { PortalKpiCard } from '@/components/portal/PortalKpiCard';
import { escapePortalCsvCell } from '@/lib/portalCsv';
import { APP_TIME_ZONE, trailingCivilDateRange } from '@/lib/utils/formatDate';
import { useTenant } from '@/hooks/useTenant';

function downloadCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escapePortalCsvCell(r[h])).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PortalReports() {
  const { currentTenant } = useTenant();
  const tenantTimeZone = currentTenant?.timezone || APP_TIME_ZONE;
  const defaultRange = useMemo(() => trailingCivilDateRange(90, tenantTimeZone), [tenantTimeZone]);
  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);

  useEffect(() => {
    setStart(defaultRange.start);
    setEnd(defaultRange.end);
  }, [defaultRange]);

  const { data, isLoading, error, refetch } = usePortalReports({ start, end });
  const invalidRange = !!start && !!end && start > end;

  return (
    <PortalSection
      title="Relatórios"
      description="Resumos operacionais das suas cargas, coletas e ocorrências."
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <Label className="text-xs">Data inicial</Label>
          <Input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} className="w-[160px]" />
        </div>
        <div>
          <Label className="text-xs">Data final</Label>
          <Input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="w-[160px]" />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setStart(defaultRange.start); setEnd(defaultRange.end); }}
        >
          Últimos 90 dias
        </Button>
      </div>

      {invalidRange ? (
        <div role="alert" className="rounded-md border border-destructive/30 p-6 text-center text-sm text-destructive">A data inicial não pode ser posterior à data final.</div>
      ) : isLoading ? (
        <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 p-8 text-center text-sm text-destructive">
          <span>Erro ao carregar relatórios: {(error as Error).message}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : !data ? (
        <PortalEmptyState title="Sem dados" description="Nenhum dado encontrado para o período." />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <PortalKpiCard label="Entregas no período" value={data.deliveries_total} icon={TruckIcon} />
            <PortalKpiCard label="Entregas atrasadas" value={data.deliveries_delayed} icon={Clock} tone={data.deliveries_delayed > 0 ? 'text-orange-500' : 'text-muted-foreground'} />
            <PortalKpiCard label="Canhotos pendentes" value={data.pending_pods} icon={ClipboardCheck} tone={data.pending_pods > 0 ? 'text-orange-500' : 'text-muted-foreground'} />
            <PortalKpiCard label="Prazo médio (dias)" value={Number(data.avg_delivery_days).toFixed(1)} icon={AlertTriangle} />
          </div>

          <ReportSection
            title="Entregas por status"
            rows={data.deliveries_by_status.map((row) => ({ ...row }))}
            columns={[{ key: 'status', label: 'Status' }, { key: 'total', label: 'Total', right: true }]}
            csvName="entregas-por-status"
          />

          <ReportSection
            title="Ocorrências por tipo"
            rows={data.occurrences_by_type.map((row) => ({ ...row }))}
            columns={[{ key: 'event_type', label: 'Tipo' }, { key: 'total', label: 'Total', right: true }]}
            csvName="ocorrencias-por-tipo"
          />

          <ReportSection
            title="Coletas por status"
            rows={data.pickups_by_status.map((row) => ({ ...row }))}
            columns={[{ key: 'status', label: 'Status' }, { key: 'total', label: 'Total', right: true }]}
            csvName="coletas-por-status"
          />

          <ReportSection
            title="Ranking de cidades"
            rows={data.top_cities.map((c) => ({ cidade: c.city, uf: c.state, total: c.total }))}
            columns={[
              { key: 'cidade', label: 'Cidade' },
              { key: 'uf', label: 'UF' },
              { key: 'total', label: 'Total', right: true },
            ]}
            csvName="ranking-cidades"
          />
        </div>
      )}
    </PortalSection>
  );

  function ReportSection({
    title, rows, columns, csvName,
  }: {
    title: string;
    rows: Array<Record<string, unknown>>;
    columns: Array<{ key: string; label: string; right?: boolean }>;
    csvName: string;
  }) {
    return (
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => downloadCsv(csvName, rows)} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Sem dados no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.key} className={c.right ? 'text-right' : ''}>{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={c.right ? 'text-right font-mono' : ''}>{String(r[c.key] ?? '')}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    );
  }
}
