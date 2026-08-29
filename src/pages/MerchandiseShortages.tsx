import { promptAction } from '@/hooks/useAlertStore';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';
import {
  useShortageCases, useCreateShortageCase, useUpdateShortageStatus,
  useShortageReportRows, useImportBatches,
  type ShortageFilters,
} from '@/hooks/useMerchandiseShortages';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import {
  computeItemTotal, computeCaseTotal, validateCase, validateFinalize, parseQuantity,
  formatBRL, monthLabel,
  type ShortageItemInput,
} from '@/lib/merchandiseShortages/shortageCalculator';
import { parseShortageWorkbook, type ImportPreview } from '@/lib/merchandiseShortages/shortageLegacyImport';
import { generateMonthlyShortageReportPdf } from '@/lib/merchandiseShortages/shortageReportPdf';
import { shortageReportToExcelBlob } from '@/lib/merchandiseShortages/shortageReportExcel';
import { shortageReportToCsvBlob } from '@/lib/merchandiseShortages/shortageReportCsv';
import { driverBreakdown, companyBreakdown, observationBreakdown, totalOf } from '@/lib/merchandiseShortages/shortageReportBuilder';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { toCompanyPdfInfo } from '@/lib/pdf/companyHeader';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STATUSES = [
  'draft','pending_review','investigating','waiting_driver','waiting_supplier','waiting_client',
  'confirmed_shortage','not_shortage','supplier_fault','driver_fault','company_fault','customer_fault',
  'charged','reimbursed','written_off','closed','cancelled',
];

const RESPONSIBLES = ['driver','supplier','customer','company','unknown','not_applicable'];

export default function MerchandiseShortages() {
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [filters, setFilters] = useState<ShortageFilters>({ month: now.getMonth() + 1, year: now.getFullYear() });
  const cases = useShortageCases(filters);
  const reports = useShortageReportRows(filters);
  const imports = useImportBatches();
  const createCase = useCreateShortageCase();
  const updateStatus = useUpdateShortageStatus();
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();

  // "Nova Falta" state
  const [form, setForm] = useState({
    occurrence_date: new Date().toISOString().slice(0, 10),
    company: '', supplier: '', driver: '', plate: '',
    invoice: '', cte: '', load: '', city: '', customer: '',
    observation: '', status: 'pending_review',
  });
  const [items, setItems] = useState<ShortageItemInput[]>([
    { product_description: '', quantity_text: '', quantity: null, unit_cost: 0, total_amount: 0 },
  ]);

  const totalCase = useMemo(() => computeCaseTotal(items), [items]);

  const updateItem = (i: number, patch: Partial<ShortageItemInput>) => {
    setItems(prev => prev.map((it, idx) => {
      if (idx !== i) return it;
      const merged = { ...it, ...patch };
      if (patch.quantity_text != null) {
        const p = parseQuantity(patch.quantity_text);
        merged.quantity = p.quantity;
        merged.unit = p.unit ?? merged.unit;
      }
      merged.total_amount = computeItemTotal(merged);
      return merged;
    }));
  };

  const addItem = () => setItems(prev => [...prev, { product_description: '', quantity_text: '', quantity: null, unit_cost: 0, total_amount: 0 }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const submitNew = async (finalize?: boolean) => {
    const errs = validateCase({
      occurrence_date: form.occurrence_date,
      invoice_number: form.invoice,
      items,
    });
    if (errs.length) { toast.error(errs[0].message); return; }
    try {
      await createCase.mutateAsync({
        occurrence_date: form.occurrence_date,
        company_name_snapshot: form.company || null,
        supplier_name_snapshot: form.supplier || null,
        driver_name_snapshot: form.driver || null,
        vehicle_plate_snapshot: form.plate || null,
        invoice_number: form.invoice || null,
        cte_number: form.cte || null,
        load_number: form.load || null,
        city: form.city || null,
        customer_name_snapshot: form.customer || null,
        observation: form.observation || null,
        status: finalize ? 'confirmed_shortage' : form.status,
        source_type: 'manual',
        items,
      });
      toast.success('Falta registrada');
      setItems([{ product_description: '', quantity_text: '', quantity: null, unit_cost: 0, total_amount: 0 }]);
      setForm({ ...form, invoice: '', customer: '', observation: '' });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const casesData = cases.data ?? [];
  const pending = casesData.filter(c => ['draft','pending_review','investigating','waiting_driver','waiting_supplier','waiting_client'].includes(c.status));
  const finalized = casesData.filter(c => ['closed','not_shortage','cancelled','written_off','reimbursed','charged'].includes(c.status));
  const inInvestigation = casesData.filter(c => c.status === 'investigating');
  const notFoundVehicle = casesData.filter(c => c.shortage_type === 'not_found_in_vehicle');
  const supplierFault = casesData.filter(c => c.shortage_type === 'supplier_fault' || c.responsible_party_type === 'supplier');
  const totalMonth = casesData.reduce((a, c) => a + Number(c.total_amount || 0), 0);
  const totalToCharge = casesData.reduce((a, c) => a + Number(c.amount_to_charge || 0), 0);
  const totalWrittenOff = casesData.reduce((a, c) => a + Number(c.amount_written_off || 0), 0);
  const totalReimbursed = casesData.reduce((a, c) => a + Number(c.amount_reimbursed || 0), 0);

  // Import
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const p = parseShortageWorkbook(buf, file.name);
    setPreview(p);
    toast.info(`${p.validRows} linhas válidas em ${p.cases.length} casos`);
  };

  const commitImport = async () => {
    if (!preview || !currentTenant?.id) return;
    setImporting(true);
    try {
      const { data: batch } = await supabase.from('merchandise_shortage_import_batches')
        .insert({ tenant_id: currentTenant.id, file_name: preview.fileName, row_count: preview.totalRows, status: 'processing' })
        .select('id').single();
      let ok = 0, err = 0;
      for (const c of preview.cases) {
        try {
          await createCase.mutateAsync({
            occurrence_date: c.occurrence_date ?? new Date().toISOString().slice(0, 10),
            company_name_snapshot: c.company,
            driver_name_snapshot: c.driver,
            invoice_number: c.invoice,
            city: c.city,
            customer_name_snapshot: c.customer,
            observation: c.observation,
            shortage_type: c.shortage_type,
            status: 'investigating',
            source_type: 'spreadsheet_import',
            import_batch_id: batch?.id ?? null,
            metadata: { sheet: c.sheet, month: c.month, year: c.year, responsible_party_type: c.responsible_party_type },
            items: c.items,
          });
          ok++;
        } catch (e) { err++; console.error(e); }
      }
      if (batch?.id) {
        await supabase.from('merchandise_shortage_import_batches')
          .update({ imported_count: ok, error_count: err, status: err ? 'completed_with_errors' : 'completed' })
          .eq('id', batch.id);
      }
      toast.success(`Importados: ${ok}, erros: ${err}`);
      setPreview(null);
    } finally {
      setImporting(false);
    }
  };

  const exportPdf = () => {
    const blob = generateMonthlyShortageReportPdf(reports.rows, {
      month, year,
      companyName: currentTenant?.name,
      company: toCompanyPdfInfo(companyProfile, currentTenant?.name),
    });
    downloadBlob(blob, `faltas-${year}-${String(month).padStart(2, '0')}.pdf`);
  };
  const exportXlsx = () => {
    downloadBlob(shortageReportToExcelBlob(reports.rows, { month, year, companyName: currentTenant?.name, filters: { ...filters } as Record<string, unknown> }), `faltas-${year}-${String(month).padStart(2, '0')}.xlsx`);
  };
  const exportCsv = () => {
    downloadBlob(shortageReportToCsvBlob(reports.rows, { month, year }), `faltas-${year}-${String(month).padStart(2, '0')}.csv`);
  };

  return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Falta de Mercadoria</h1>
            <p className="text-sm text-muted-foreground">Controle mensal de apuração de faltas</p>
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <Label className="text-xs">Mês</Label>
              <Input type="number" min={1} max={12} value={month} onChange={e => { const m = Number(e.target.value); setMonth(m); setFilters(f => ({ ...f, month: m })); }} className="w-20" />
            </div>
            <div>
              <Label className="text-xs">Ano</Label>
              <Input type="number" value={year} onChange={e => { const y = Number(e.target.value); setYear(y); setFilters(f => ({ ...f, year: y })); }} className="w-24" />
            </div>
          </div>
        </div>

        <Tabs defaultValue="list" className="space-y-4">
          <TabsList>
            <TabsTrigger value="list">Lançamentos</TabsTrigger>
            <TabsTrigger value="new">Nova Falta</TabsTrigger>
            <TabsTrigger value="apurar">Apuração</TabsTrigger>
            <TabsTrigger value="report">Relatório Mensal</TabsTrigger>
            <TabsTrigger value="responsibles">Responsabilidades</TabsTrigger>
            <TabsTrigger value="import">Importar Legado</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <MetricCard label="Faltas no mês" value={String(casesData.length)} />
              <MetricCard label="Valor total" value={formatBRL(totalMonth)} />
              <MetricCard label="A cobrar" value={formatBRL(totalToCharge)} />
              <MetricCard label="Assumido" value={formatBRL(totalWrittenOff)} />
              <MetricCard label="Ressarcido" value={formatBRL(totalReimbursed)} />
              <MetricCard label="Pendentes" value={String(pending.length)} />
              <MetricCard label="Em apuração" value={String(inInvestigation.length)} />
              <MetricCard label="Finalizadas" value={String(finalized.length)} />
              <MetricCard label="Não localizado no veículo" value={String(notFoundVehicle.length)} />
              <MetricCard label="Falta do fornecedor" value={String(supplierFault.length)} />
            </div>

            <Card>
              <CardHeader className="flex flex-row gap-2 items-end flex-wrap">
                <div>
                  <Label className="text-xs">Motorista</Label>
                  <Input value={filters.driver ?? ''} onChange={e => setFilters({ ...filters, driver: e.target.value || null })} />
                </div>
                <div>
                  <Label className="text-xs">Empresa</Label>
                  <Input value={filters.company ?? ''} onChange={e => setFilters({ ...filters, company: e.target.value || null })} />
                </div>
                <div>
                  <Label className="text-xs">NF</Label>
                  <Input value={filters.invoice ?? ''} onChange={e => setFilters({ ...filters, invoice: e.target.value || null })} />
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={filters.status ?? '__none__'} onValueChange={v => setFilters({ ...filters, status: v === '__none__' ? null : v })}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Todos</SelectItem>
                      {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={() => setFilters({ month, year })}>Limpar</Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Empresa</TableHead>
                        <TableHead>Motorista</TableHead>
                        <TableHead>NF</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Responsável</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {casesData.map(c => (
                        <TableRow key={c.id}>
                          <TableCell>{c.occurrence_date}</TableCell>
                          <TableCell>{c.company_name_snapshot}</TableCell>
                          <TableCell>{c.driver_name_snapshot}</TableCell>
                          <TableCell>{c.invoice_number}</TableCell>
                          <TableCell>{c.city}</TableCell>
                          <TableCell>{c.customer_name_snapshot}</TableCell>
                          <TableCell className="text-right">{formatBRL(Number(c.total_amount))}</TableCell>
                          <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                          <TableCell>{c.responsible_party_type ?? '-'}</TableCell>
                        </TableRow>
                      ))}
                      {casesData.length === 0 && (
                        <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Nenhuma falta no período</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="new">
            <Card>
              <CardHeader><CardTitle>Nova Falta</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Data"><Input type="date" value={form.occurrence_date} onChange={e => setForm({ ...form, occurrence_date: e.target.value })} /></Field>
                  <Field label="Empresa/Remetente"><Input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} /></Field>
                  <Field label="Fornecedor"><Input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} /></Field>
                  <Field label="Motorista"><Input value={form.driver} onChange={e => setForm({ ...form, driver: e.target.value })} /></Field>
                  <Field label="Placa"><Input value={form.plate} onChange={e => setForm({ ...form, plate: e.target.value })} /></Field>
                  <Field label="Carga"><Input value={form.load} onChange={e => setForm({ ...form, load: e.target.value })} /></Field>
                  <Field label="NF"><Input value={form.invoice} onChange={e => setForm({ ...form, invoice: e.target.value })} /></Field>
                  <Field label="CT-e"><Input value={form.cte} onChange={e => setForm({ ...form, cte: e.target.value })} /></Field>
                  <Field label="Cidade"><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></Field>
                  <Field label="Cliente"><Input value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} /></Field>
                  <Field label="Observação geral">
                    <Input value={form.observation} onChange={e => setForm({ ...form, observation: e.target.value })} />
                  </Field>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">Itens</h3>
                    <Button size="sm" onClick={addItem}>Adicionar item</Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="w-32">Quantidade</TableHead>
                        <TableHead className="w-28">Custo un.</TableHead>
                        <TableHead className="w-28 text-right">Total</TableHead>
                        <TableHead>Obs.</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((it, i) => (
                        <TableRow key={i}>
                          <TableCell><Input value={it.product_description} onChange={e => updateItem(i, { product_description: e.target.value })} /></TableCell>
                          <TableCell><Input value={it.quantity_text ?? ''} onChange={e => updateItem(i, { quantity_text: e.target.value })} /></TableCell>
                          <TableCell><Input type="number" step="0.01" value={it.unit_cost ?? 0} onChange={e => updateItem(i, { unit_cost: Number(e.target.value) })} /></TableCell>
                          <TableCell className="text-right">{formatBRL(it.total_amount ?? 0)}</TableCell>
                          <TableCell><Input value={it.item_observation ?? ''} onChange={e => updateItem(i, { item_observation: e.target.value })} /></TableCell>
                          <TableCell><Button variant="ghost" size="sm" onClick={() => removeItem(i)}>x</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="text-right mt-2 font-semibold">Total do caso: {formatBRL(totalCase)}</div>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => submitNew(false)}>Salvar em apuração</Button>
                  <Button onClick={() => submitNew(true)}>Salvar e confirmar</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="apurar">
            <Card>
              <CardHeader><CardTitle>Apuração de Casos</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>NF</TableHead>
                      <TableHead>Motorista</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Resp.</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map(c => (
                      <TableRow key={c.id}>
                        <TableCell>{c.shortage_number}</TableCell>
                        <TableCell>{c.occurrence_date}</TableCell>
                        <TableCell>{c.invoice_number}</TableCell>
                        <TableCell>{c.driver_name_snapshot}</TableCell>
                        <TableCell>{formatBRL(Number(c.total_amount))}</TableCell>
                        <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                        <TableCell>{c.responsible_party_type ?? '-'}</TableCell>
                        <TableCell className="space-x-1">
                          <Select onValueChange={async (v) => {
                            const errs = validateFinalize(v, { responsible_party_type: c.responsible_party_type });
                            if (errs.length && v === 'closed') { toast.error(errs[0].message); return; }
                            if (v === 'cancelled') {
                              const reason = await promptAction('Informe por que esta ocorrência deve ser cancelada.', {
                                title: 'Cancelar ocorrência',
                                label: 'Motivo do cancelamento',
                              });
                              if (!reason) return;
                              await updateStatus.mutateAsync({ case_id: c.id, status: v, payload: { cancellation_reason: reason } });
                            } else {
                              await updateStatus.mutateAsync({ case_id: c.id, status: v });
                            }
                            toast.success('Status atualizado');
                          }}>
                            <SelectTrigger className="w-40"><SelectValue placeholder="Alterar status" /></SelectTrigger>
                            <SelectContent>
                              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select onValueChange={async (v) => {
                            await updateStatus.mutateAsync({ case_id: c.id, status: c.status, payload: { responsible_party_type: v } });
                            toast.success('Responsável definido');
                          }}>
                            <SelectTrigger className="w-36"><SelectValue placeholder="Responsável" /></SelectTrigger>
                            <SelectContent>
                              {RESPONSIBLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                    {pending.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Sem casos pendentes</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="report" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle>Relatório Mensal — {monthLabel(month, year)}</CardTitle>
                <div className="flex gap-2">
                  <Button onClick={exportPdf}>PDF</Button>
                <Button variant="outline" onClick={exportXlsx}>Excel</Button>
                  <Button variant="outline" onClick={exportCsv}>CSV</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <MetricCard label="Itens" value={String(reports.rows.length)} />
                  <MetricCard label="Casos" value={String(reports.cases.length)} />
                  <MetricCard label="Total (R$)" value={formatBRL(totalOf(reports.rows))} />
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <SubtotalTable title="Por Motorista" rows={driverBreakdown(reports.rows).map(d => ({ key: d.driver_name, items: d.item_count, total: d.total_amount }))} />
                  <SubtotalTable title="Por Empresa" rows={companyBreakdown(reports.rows).map(d => ({ key: d.company_name, items: d.item_count, total: d.total_amount }))} />
                  <SubtotalTable title="Por Observação" rows={observationBreakdown(reports.rows).map(d => ({ key: d.observation, items: d.item_count, total: d.total_amount }))} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="responsibles">
            <Card>
              <CardHeader><CardTitle>Responsabilidades</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Responsável</TableHead><TableHead>Casos</TableHead>
                    <TableHead>Total</TableHead><TableHead>A cobrar</TableHead>
                    <TableHead>Ressarcido</TableHead><TableHead>Baixado</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {RESPONSIBLES.map(r => {
                      const items = casesData.filter(c => c.responsible_party_type === r);
                      const tot = items.reduce((a, c) => a + Number(c.total_amount || 0), 0);
                      const cob = items.reduce((a, c) => a + Number(c.amount_to_charge || 0), 0);
                      const res = items.reduce((a, c) => a + Number(c.amount_reimbursed || 0), 0);
                      const bx = items.reduce((a, c) => a + Number(c.amount_written_off || 0), 0);
                      return (
                        <TableRow key={r}>
                          <TableCell>{r}</TableCell><TableCell>{items.length}</TableCell>
                          <TableCell>{formatBRL(tot)}</TableCell>
                          <TableCell>{formatBRL(cob)}</TableCell>
                          <TableCell>{formatBRL(res)}</TableCell>
                          <TableCell>{formatBRL(bx)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="import" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Importar planilha legada</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Input type="file" accept=".xlsx,.xls" onChange={e => handleFile(e.target.files?.[0] ?? null)} />
                {preview && (
                  <div className="space-y-2 text-sm">
                    <div>Arquivo: {preview.fileName}</div>
                    <div>Meses detectados: {preview.detectedMonths.join(', ') || '—'}</div>
                    <div>Linhas válidas: {preview.validRows} | Subtotais ignorados: {preview.skippedSubtotals} | Casos: {preview.cases.length}</div>
                    <div>Total calculado: {formatBRL(preview.totalAmountCalculated)}</div>
                    <Button onClick={commitImport} disabled={importing}>{importing ? 'Importando…' : 'Confirmar importação'}</Button>
                  </div>
                )}
                <div className="border-t pt-3">
                  <h4 className="font-semibold mb-2">Últimas importações</h4>
                  <Table>
                    <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Arquivo</TableHead><TableHead>Linhas</TableHead><TableHead>OK</TableHead><TableHead>Erros</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(imports.data ?? []).map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>{new Date(b.created_at).toLocaleString('pt-BR')}</TableCell>
                          <TableCell>{b.file_name}</TableCell>
                          <TableCell>{b.row_count}</TableCell>
                          <TableCell>{b.imported_count}</TableCell>
                          <TableCell>{b.error_count}</TableCell>
                          <TableCell>{b.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function SubtotalTable({ title, rows }: { title: string; rows: { key: string; items: number; total: number }[] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>{title.replace('Por ', '')}</TableHead><TableHead className="text-right">Itens</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.slice(0, 10).map(r => (
              <TableRow key={r.key}><TableCell className="truncate max-w-[140px]">{r.key}</TableCell><TableCell className="text-right">{r.items}</TableCell><TableCell className="text-right">{formatBRL(r.total)}</TableCell></TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-2">—</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
