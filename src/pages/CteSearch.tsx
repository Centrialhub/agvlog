import { useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PendingInvoicesBanner } from '@/components/billing/PendingInvoicesBanner';
import {
  useCteSearch, CTE_TYPE_LABELS,
  type CteSearchFilters, type CteType, type TriState,
} from '@/hooks/useCteSearch';
import { SEFAZ_STATUS_LABELS, SEFAZ_STATUS_TONE, type SefazStatus } from '@/hooks/useCteMonitor';
import { Search, X, Filter as FilterIcon, FileText, FileDown, Eye, RefreshCw } from 'lucide-react';

const TONE_CLASS: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  danger: 'bg-destructive/15 text-destructive border border-destructive/30',
  muted: 'bg-muted text-muted-foreground',
};

function StatusPill({ status }: { status: string }) {
  const tone = SEFAZ_STATUS_TONE[status as SefazStatus] ?? 'default';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {SEFAZ_STATUS_LABELS[status as SefazStatus] ?? status}
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

function TriRadio({
  label, value, onChange,
}: { label: string; value: TriState; onChange: (v: TriState) => void }) {
  const opts: { v: TriState; l: string }[] = [
    { v: 'all', l: 'Todos' }, { v: 'yes', l: 'Sim' }, { v: 'no', l: 'Não' },
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        {opts.map((o) => (
          <label key={o.v} className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="radio" checked={value === o.v} onChange={() => onChange(o.v)} />
            {o.l}
          </label>
        ))}
      </div>
    </div>
  );
}

const ALL_CTE_TYPES: CteType[] = ['normal', 'complementary', 'voiding', 'substitute'];

const DEFAULT_FILTERS: CteSearchFilters = {
  cteTypes: ['normal', 'complementary', 'voiding', 'substitute'],
  voided: 'no',
  closed: 'all',
  compensated: 'all',
  autonomousFreight: 'all',
  complementaryDoc: 'all',
};

export default function CteSearch() {
  const [draft, setDraft] = useState<CteSearchFilters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<CteSearchFilters>(DEFAULT_FILTERS);
  const { data: rows = [], isLoading, isFetching, refetch } = useCteSearch(filters);

  function apply() { setFilters(draft); }
  function clear() { setDraft(DEFAULT_FILTERS); setFilters(DEFAULT_FILTERS); }

  function toggleType(t: CteType) {
    const cur = new Set(draft.cteTypes ?? []);
    if (cur.has(t)) cur.delete(t); else cur.add(t);
    setDraft({ ...draft, cteTypes: Array.from(cur) });
  }

  const totals = useMemo(() => {
    let freight = 0, cargo = 0;
    for (const r of rows as any[]) { freight += Number(r.freight_value ?? 0); cargo += Number(r.cargo_value ?? 0); }
    return { count: rows.length, freight, cargo };
  }, [rows]);

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 p-4">
        <PendingInvoicesBanner from="search" />

        <header className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Consulta CT-e (Conhecimento)</h1>
            <p className="text-sm text-muted-foreground">
              Busca avançada nos CT-e gerados — equivalente à Consulta-Conhecimento do SIAT.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{totals.count} registro(s)</Badge>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
        </header>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <FilterIcon className="h-4 w-4" /> <h2 className="font-medium">Filtros</h2>
          </div>

          {/* Linha 1: identificação */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Field label="Nº Doc"><Input value={draft.docNumber ?? ''} onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })} /></Field>
            <Field label="Nº Interno"><Input value={draft.internalNumber ?? ''} onChange={(e) => setDraft({ ...draft, internalNumber: e.target.value })} /></Field>
            <Field label="Nº Ref."><Input value={draft.referenceNumber ?? ''} onChange={(e) => setDraft({ ...draft, referenceNumber: e.target.value })} /></Field>
            <Field label="Série"><Input value={draft.series ?? ''} onChange={(e) => setDraft({ ...draft, series: e.target.value })} /></Field>
            <Field label="Emissão — Início"><Input type="date" value={draft.issueDateStart ?? ''} onChange={(e) => setDraft({ ...draft, issueDateStart: e.target.value })} /></Field>
            <Field label="Emissão — Fim"><Input type="date" value={draft.issueDateEnd ?? ''} onChange={(e) => setDraft({ ...draft, issueDateEnd: e.target.value })} /></Field>
          </div>

          {/* Linha 2: partes */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Field label="Remetente"><Input value={draft.remitter ?? ''} onChange={(e) => setDraft({ ...draft, remitter: e.target.value })} /></Field>
            <Field label="Destinatário"><Input value={draft.recipient ?? ''} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} /></Field>
            <Field label="Consignatário"><Input value={draft.consignee ?? ''} onChange={(e) => setDraft({ ...draft, consignee: e.target.value })} /></Field>
            <Field label="Pagador"><Input value={draft.payer ?? ''} onChange={(e) => setDraft({ ...draft, payer: e.target.value })} /></Field>
            <Field label="Grp Pagador"><Input value={draft.payerGroup ?? ''} onChange={(e) => setDraft({ ...draft, payerGroup: e.target.value })} /></Field>
            <Field label="Seguradora"><Input value={draft.insuranceCompany ?? ''} onChange={(e) => setDraft({ ...draft, insuranceCompany: e.target.value })} /></Field>
          </div>

          {/* Linha 3: viagem */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-3">
            <Field label="Motorista"><Input value={draft.driverName ?? ''} onChange={(e) => setDraft({ ...draft, driverName: e.target.value })} /></Field>
            <Field label="Placa"><Input value={draft.vehiclePlate ?? ''} onChange={(e) => setDraft({ ...draft, vehiclePlate: e.target.value })} /></Field>
            <Field label="Placa Carreta"><Input value={draft.trailerPlate ?? ''} onChange={(e) => setDraft({ ...draft, trailerPlate: e.target.value })} /></Field>
            <Field label="Nº Contrato"><Input value={draft.contractNumber ?? ''} onChange={(e) => setDraft({ ...draft, contractNumber: e.target.value })} /></Field>
            <Field label="Nº Viagem"><Input value={draft.tripNumber ?? ''} onChange={(e) => setDraft({ ...draft, tripNumber: e.target.value })} /></Field>
            <Field label="Nota Fiscal"><Input value={draft.invoiceNumber ?? ''} onChange={(e) => setDraft({ ...draft, invoiceNumber: e.target.value })} /></Field>
            <Field label="Romexp"><Input value={draft.romexpNumber ?? ''} onChange={(e) => setDraft({ ...draft, romexpNumber: e.target.value })} /></Field>
            <Field label="Nº Ped. Cliente"><Input value={draft.clientLoadNumber ?? ''} onChange={(e) => setDraft({ ...draft, clientLoadNumber: e.target.value })} /></Field>
          </div>

          {/* Tipos CT-e + situações */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Tipo CT-e</p>
              <div className="flex flex-wrap gap-3">
                {ALL_CTE_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={(draft.cteTypes ?? []).includes(t)} onCheckedChange={() => toggleType(t)} />
                    {CTE_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <TriRadio label="Anulado" value={draft.voided ?? 'all'} onChange={(v) => setDraft({ ...draft, voided: v })} />
              <TriRadio label="Encerrado" value={draft.closed ?? 'all'} onChange={(v) => setDraft({ ...draft, closed: v })} />
              <TriRadio label="Compensado" value={draft.compensated ?? 'all'} onChange={(v) => setDraft({ ...draft, compensated: v })} />
              <TriRadio label="Frete Autônomo" value={draft.autonomousFreight ?? 'all'} onChange={(v) => setDraft({ ...draft, autonomousFreight: v })} />
              <TriRadio label="Doc. Complementar" value={draft.complementaryDoc ?? 'all'} onChange={(v) => setDraft({ ...draft, complementaryDoc: v })} />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={apply} size="sm"><Search className="h-4 w-4" /> Aplicar</Button>
            <Button onClick={clear} variant="outline" size="sm"><X className="h-4 w-4" /> Limpar</Button>
          </div>
        </Card>

        {/* Totais */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3"><p className="text-xs text-muted-foreground">CT-e encontrados</p><p className="text-2xl font-semibold">{totals.count}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">Total Frete</p><p className="text-2xl font-semibold">{totals.freight.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">Total Carga</p><p className="text-2xl font-semibold">{totals.cargo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p></Card>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-left px-3 py-2">Nº CT-e</th>
                  <th className="text-left px-3 py-2">Sér.</th>
                  <th className="text-left px-3 py-2">Emissão</th>
                  <th className="text-left px-3 py-2">Pagador</th>
                  <th className="text-left px-3 py-2">Remetente</th>
                  <th className="text-left px-3 py-2">Destinatário</th>
                  <th className="text-left px-3 py-2">UF</th>
                  <th className="text-left px-3 py-2">Placa</th>
                  <th className="text-right px-3 py-2">Frete</th>
                  <th className="text-right px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={12} className="text-center text-muted-foreground py-8">Carregando…</td></tr>}
                {!isLoading && rows.length === 0 && <tr><td colSpan={12} className="text-center text-muted-foreground py-8">Nenhum CT-e encontrado.</td></tr>}
                {(rows as any[]).map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2"><StatusPill status={r.sefaz_status ?? 'pending'} /></td>
                    <td className="px-3 py-2 text-xs">{CTE_TYPE_LABELS[r.cte_type as CteType] ?? r.cte_type}</td>
                    <td className="px-3 py-2 font-mono">{r.cte_number ?? '—'}</td>
                    <td className="px-3 py-2">{r.cte_series ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.issued_at ? new Date(r.issued_at).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="px-3 py-2">{r.payer_name ?? '—'}</td>
                    <td className="px-3 py-2">{r.remitter ?? '—'}</td>
                    <td className="px-3 py-2">{r.recipient ?? '—'}</td>
                    <td className="px-3 py-2">{r.recipient_state ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{r.vehicle_plate ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{Number(r.freight_value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noreferrer" title="PDF" className="inline-flex"><Button size="sm" variant="ghost"><FileText className="h-4 w-4" /></Button></a>}
                        {r.xml_url && <a href={r.xml_url} target="_blank" rel="noreferrer" title="XML" className="inline-flex"><Button size="sm" variant="ghost"><FileDown className="h-4 w-4" /></Button></a>}
                        <a href={`/cte-monitor?id=${r.id}`} title="Detalhe" className="inline-flex"><Button size="sm" variant="ghost"><Eye className="h-4 w-4" /></Button></a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}