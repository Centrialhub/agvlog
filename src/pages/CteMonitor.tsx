import { useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  useCteMonitor, useCteSefazEvents, useResendCte,
  SEFAZ_STATUS_LABELS, SEFAZ_STATUS_TONE, SEFAZ_STATUSES,
  type CteMonitorRow, type CteMonitorFilters, type SefazStatus,
} from '@/hooks/useCteMonitor';
import {
  FileText, FileDown, RefreshCw, Search, Filter as FilterIcon, X, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

const TONE_CLASS: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  danger: 'bg-destructive/15 text-destructive border border-destructive/30',
  muted: 'bg-muted text-muted-foreground',
};

function StatusPill({ status }: { status: SefazStatus }) {
  const tone = SEFAZ_STATUS_TONE[status] ?? 'default';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {SEFAZ_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const DEFAULT_STATUSES: SefazStatus[] = ['pending', 'sent_error', 'processed_error', 'cancel_error'];

export default function CteMonitor() {
  const [filters, setFilters] = useState<CteMonitorFilters>({
    statuses: DEFAULT_STATUSES,
    correctionLetter: 'all',
  });
  const [draft, setDraft] = useState<CteMonitorFilters>(filters);
  const [selected, setSelected] = useState<CteMonitorRow | null>(null);

  const { data: rows = [], isLoading, refetch, isFetching } = useCteMonitor(filters);
  const resend = useResendCte();

  const counts = useMemo(() => {
    const c = { total: rows.length, errors: 0, processed: 0, pending: 0, cancelled: 0 };
    for (const r of rows) {
      if (r.sefaz_status.endsWith('_error')) c.errors++;
      else if (r.sefaz_status === 'processed') c.processed++;
      else if (r.sefaz_status === 'pending') c.pending++;
      else if (r.sefaz_status === 'cancelled') c.cancelled++;
    }
    return c;
  }, [rows]);

  function applyFilters() {
    setFilters(draft);
  }
  function clearFilters() {
    const cleared: CteMonitorFilters = { statuses: DEFAULT_STATUSES, correctionLetter: 'all' };
    setDraft(cleared);
    setFilters(cleared);
  }

  function toggleStatus(s: SefazStatus) {
    const cur = new Set(draft.statuses ?? []);
    if (cur.has(s)) cur.delete(s);
    else cur.add(s);
    setDraft({ ...draft, statuses: Array.from(cur) });
  }

  async function downloadXml(row: CteMonitorRow) {
    if (row.xml_url) {
      window.open(row.xml_url, '_blank');
      return;
    }
    toast.error('XML não disponível para este CT-e');
  }
  async function downloadPdf(row: CteMonitorRow) {
    if (row.pdf_url) {
      window.open(row.pdf_url, '_blank');
      return;
    }
    toast.error('PDF (DACTE) não disponível para este CT-e');
  }

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Monitor DOC-e (CT-e)</h1>
            <p className="text-sm text-muted-foreground">
              Acompanhamento dos CT-e enviados à SEFAZ — status, motivo de erro, PDF/XML e histórico de eventos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{counts.total} registro(s)</Badge>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
        </header>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-semibold">{counts.total}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Processados</p>
            <p className="text-2xl font-semibold text-emerald-600">{counts.processed}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Erros</p>
            <p className="text-2xl font-semibold text-destructive">{counts.errors}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Pendentes</p>
            <p className="text-2xl font-semibold">{counts.pending}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Cancelados</p>
            <p className="text-2xl font-semibold text-muted-foreground">{counts.cancelled}</p>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <FilterIcon className="h-4 w-4" />
            <h2 className="font-medium">Filtros</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Field label="Nº Doc">
              <Input value={draft.docNumber ?? ''} onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })} />
            </Field>
            <Field label="Pagador">
              <Input value={draft.payer ?? ''} onChange={(e) => setDraft({ ...draft, payer: e.target.value })} />
            </Field>
            <Field label="Nº Interno">
              <Input value={draft.internalNumber ?? ''} onChange={(e) => setDraft({ ...draft, internalNumber: e.target.value })} />
            </Field>
            <Field label="Nº Compensação / Ref.">
              <Input value={draft.referenceNumber ?? ''} onChange={(e) => setDraft({ ...draft, referenceNumber: e.target.value })} />
            </Field>
            <Field label="Nº Protocolo">
              <Input value={draft.protocolNumber ?? ''} onChange={(e) => setDraft({ ...draft, protocolNumber: e.target.value })} />
            </Field>
            <Field label="Chave de Acesso (44)">
              <Input value={draft.accessKey ?? ''} onChange={(e) => setDraft({ ...draft, accessKey: e.target.value })} />
            </Field>
            <Field label="Placa">
              <Input value={draft.plate ?? ''} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} />
            </Field>
            <Field label="Motorista">
              <Input value={draft.driver ?? ''} onChange={(e) => setDraft({ ...draft, driver: e.target.value })} />
            </Field>
            <Field label="Série">
              <Input value={draft.series ?? ''} onChange={(e) => setDraft({ ...draft, series: e.target.value })} />
            </Field>
            <Field label="Filial">
              <Input value={draft.branch ?? ''} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} />
            </Field>
            <Field label="Grupo Empresa">
              <Input value={draft.companyGroup ?? ''} onChange={(e) => setDraft({ ...draft, companyGroup: e.target.value })} />
            </Field>
            <Field label="Grupo Pagador">
              <Input value={draft.payerGroup ?? ''} onChange={(e) => setDraft({ ...draft, payerGroup: e.target.value })} />
            </Field>
            <Field label="Processamento — Início">
              <Input type="date" value={draft.processedStart ?? ''} onChange={(e) => setDraft({ ...draft, processedStart: e.target.value })} />
            </Field>
            <Field label="Processamento — Fim">
              <Input type="date" value={draft.processedEnd ?? ''} onChange={(e) => setDraft({ ...draft, processedEnd: e.target.value })} />
            </Field>
            <Field label="Emissão — Início">
              <Input type="date" value={draft.issuedStart ?? ''} onChange={(e) => setDraft({ ...draft, issuedStart: e.target.value })} />
            </Field>
            <Field label="Emissão — Fim">
              <Input type="date" value={draft.issuedEnd ?? ''} onChange={(e) => setDraft({ ...draft, issuedEnd: e.target.value })} />
            </Field>
          </div>

          {/* Status checkboxes */}
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Status (DOC-e)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {SEFAZ_STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={(draft.statuses ?? []).includes(s)}
                    onCheckedChange={() => toggleStatus(s)}
                  />
                  <span>{SEFAZ_STATUS_LABELS[s]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Carta de correção */}
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Carta de Correção</span>
            {(['all', 'yes', 'no'] as const).map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="cce"
                  checked={(draft.correctionLetter ?? 'all') === v}
                  onChange={() => setDraft({ ...draft, correctionLetter: v })}
                />
                <span>{v === 'all' ? 'Todos' : v === 'yes' ? 'Sim' : 'Não'}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={applyFilters} size="sm">
              <Search className="h-4 w-4" /> Aplicar filtros
            </Button>
            <Button onClick={clearFilters} variant="outline" size="sm">
              <X className="h-4 w-4" /> Limpar
            </Button>
          </div>
        </Card>

        {/* Tabela */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Nº CT-e</th>
                  <th className="text-left px-3 py-2">Série</th>
                  <th className="text-left px-3 py-2">Pagador</th>
                  <th className="text-left px-3 py-2">Destinatário</th>
                  <th className="text-left px-3 py-2">UF</th>
                  <th className="text-left px-3 py-2">Placa</th>
                  <th className="text-left px-3 py-2">Protocolo</th>
                  <th className="text-left px-3 py-2">Processado em</th>
                  <th className="text-left px-3 py-2">Motivo / Erro</th>
                  <th className="text-right px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={11} className="text-center text-muted-foreground py-8">Carregando…</td></tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={11} className="text-center text-muted-foreground py-8">Nenhum CT-e encontrado com os filtros atuais.</td></tr>
                )}
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-3 py-2"><StatusPill status={r.sefaz_status} /></td>
                    <td className="px-3 py-2 font-mono">{r.cte_number ?? '—'}</td>
                    <td className="px-3 py-2">{r.cte_series ?? '—'}</td>
                    <td className="px-3 py-2">{r.payer_name ?? r.recipient ?? '—'}</td>
                    <td className="px-3 py-2">{r.recipient ?? '—'}</td>
                    <td className="px-3 py-2">{r.recipient_state ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{r.vehicle_plate ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.protocol_number ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.processed_at ? new Date(r.processed_at).toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-xs truncate" title={r.sefaz_status_reason ?? ''}>
                      {r.sefaz_status_reason ? (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertCircle className="h-3 w-3" /> {r.sefaz_status_reason}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" title="Baixar PDF (DACTE)" onClick={() => downloadPdf(r)}>
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Baixar XML" onClick={() => downloadXml(r)}>
                          <FileDown className="h-4 w-4" />
                        </Button>
                        {r.sefaz_status.endsWith('_error') && (
                          <Button size="sm" variant="ghost" title="Reenviar à SEFAZ" onClick={() => resend.mutate(r.id, {
                            onSuccess: () => toast.success('CT-e marcado para reenvio'),
                            onError: (e: any) => toast.error(e.message ?? 'Falha ao reenviar'),
                          })}>
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-3xl">
            {selected && <CteDetail row={selected} onClose={() => setSelected(null)} />}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

function CteDetail({ row, onClose }: { row: CteMonitorRow; onClose: () => void }) {
  const { data: events = [] } = useCteSefazEvents(row.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          CT-e {row.cte_number ?? '—'} <StatusPill status={row.sefaz_status} />
        </DialogTitle>
        <DialogDescription>
          Chave: <span className="font-mono">{row.access_key ?? '—'}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-muted-foreground">Pagador:</span> {row.payer_name ?? '—'}</div>
        <div><span className="text-muted-foreground">CNPJ Pagador:</span> {row.payer_cnpj ?? '—'}</div>
        <div><span className="text-muted-foreground">Destinatário:</span> {row.recipient ?? '—'}</div>
        <div><span className="text-muted-foreground">Cidade/UF:</span> {row.recipient_city ?? '—'} / {row.recipient_state ?? '—'}</div>
        <div><span className="text-muted-foreground">Protocolo:</span> {row.protocol_number ?? '—'}</div>
        <div><span className="text-muted-foreground">Ambiente:</span> {row.sefaz_environment ?? '—'}</div>
        <div><span className="text-muted-foreground">Placa:</span> {row.vehicle_plate ?? '—'}</div>
        <div><span className="text-muted-foreground">Motorista:</span> {row.driver_name ?? '—'}</div>
        <div><span className="text-muted-foreground">Frete:</span> R$ {Number(row.freight_value).toFixed(2)}</div>
        <div><span className="text-muted-foreground">Carga:</span> R$ {Number(row.cargo_value).toFixed(2)}</div>
      </div>

      {row.sefaz_status_reason && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-1"><AlertCircle className="h-4 w-4" /> Motivo do erro</p>
          <p className="mt-1">{row.sefaz_status_reason}</p>
          {row.sefaz_status_code && <p className="text-xs mt-1 text-muted-foreground">Código: {row.sefaz_status_code}</p>}
        </div>
      )}

      <div>
        <h3 className="font-medium text-sm mb-2">Histórico de eventos SEFAZ</h3>
        <div className="border rounded max-h-64 overflow-y-auto divide-y">
          {events.length === 0 && (
            <p className="text-xs text-muted-foreground p-3">Nenhum evento registrado ainda. A integração fiscal envia os eventos via webhook.</p>
          )}
          {events.map((e) => (
            <div key={e.id} className="p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium">{e.event_type}</span>
                <span className="text-muted-foreground">{new Date(e.occurred_at).toLocaleString('pt-BR')}</span>
              </div>
              {e.reason && <div className="text-muted-foreground">{e.reason}</div>}
              {e.protocol_number && <div className="text-muted-foreground">Protocolo: {e.protocol_number}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {row.pdf_url && <Button variant="outline" size="sm" asChild><a href={row.pdf_url} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" /> PDF</a></Button>}
        {row.xml_url && <Button variant="outline" size="sm" asChild><a href={row.xml_url} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" /> XML</a></Button>}
        <Button size="sm" onClick={onClose}>Fechar</Button>
      </div>
    </>
  );
}