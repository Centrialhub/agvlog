import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useImportedNotes, exportImportedNotesCsv, getImportedNoteSummaryTotals,
  createSummaryReportSnapshot, NOTE_STATUS_LABELS,
  type ImportedNoteRow, type ImportedNoteFilters, type NoteOperationalStatus,
} from '@/hooks/useImportedNotesSummary';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Printer, Download, Search, RefreshCw, X, FileText, PackageCheck, ShieldCheck, Trash2, CheckSquare, FileSpreadsheet } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { downloadImportedNotesSummaryPdf, type SummaryReportType } from '@/lib/importedNotesSummaryPdf';
import { downloadImportedNotesXlsx } from '@/lib/importedNotesXlsx';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { supabase } from '@/integrations/supabase/client';
import { useSortableData } from '@/hooks/useSortableData';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Checkbox } from "@/components/ui/checkbox";

const dt = (s?: any) => s ? new Date(String(s).length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('pt-BR') : '—';
const brl = (n: any) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num3 = (n: any) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const STATUS_VARIANT: Record<string, any> = {
  delivered: 'default', in_transit: 'secondary', processed: 'secondary',
  not_delivered: 'destructive', not_processed: 'outline', not_processed_redispatch: 'outline',
  transferred: 'secondary', not_transferred: 'destructive',
};

const emptyFilters: ImportedNoteFilters = {
  branch: null, controlLot: null, dynamicLot: null,
  issueFrom: null, issueTo: null, importFrom: null, importTo: null,
  remitter: null, clientId: null, supplierId: null, originCity: null, destinationCity: null,
  status: 'all', invoiceNumber: null, grouped: true,
};

export default function ImportedNotesSummary() {
  const navigate = useNavigate();
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();
  const { data: clients = [] } = useClients();
  const [filters, setFilters] = useState<ImportedNoteFilters>(emptyFilters);
  const [applied, setApplied] = useState<ImportedNoteFilters>(emptyFilters);
  const { data: rowsData = [], isLoading, refetch } = useImportedNotes(applied);
  const { sortedItems: rows, requestSort, sortConfig } = useSortableData(rowsData);

  const [printDlgOpen, setPrintDlgOpen] = useState(false);
  const [reportType, setReportType] = useState<SummaryReportType>('destination_summary');
  const [detailRow, setDetailRow] = useState<ImportedNoteRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionDlg, setBulkActionDlg] = useState<{ open: boolean; type: 'audit' | 'delete' | null }>({ open: false, type: null });

  const totals = useMemo(() => getImportedNoteSummaryTotals(rows), [rows]);
  const set = (k: keyof ImportedNoteFilters, v: any) => setFilters(f => ({ ...f, [k]: v === '' ? null : v }));

  const doSearch = () => setApplied(filters);
  const doClear = () => { setFilters(emptyFilters); setApplied(emptyFilters); };

  const handleAudit = async (row: ImportedNoteRow) => {
    try {
      const { error } = await supabase
        .from('fiscal_documents')
        .update({ imported_note_status: 'processed' })
        .eq('id', row.id);
      
      if (error) throw error;
      toast.success(`Nota ${row.invoice_number} auditada com sucesso.`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Falha ao auditar nota');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { error } = await supabase
        .rpc('soft_delete_fiscal_document', { 
          doc_id: deleteId,
          user_id: user.id
        });
      
      if (error) throw error;
      toast.success('Nota excluída com sucesso (arquivada para histórico).');
      setDetailRow(null);
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Falha ao excluir nota');
    } finally {
      setIsDeleting(false);
      setDeleteId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map(r => r.id)));
    }
  };

  const handleBulkAudit = async () => {
    if (selectedIds.size === 0) return;
    try {
      const { error } = await supabase
        .from('fiscal_documents')
        .update({ imported_note_status: 'processed' })
        .in('id', Array.from(selectedIds));
      
      if (error) throw error;
      toast.success(`${selectedIds.size} notas auditadas com sucesso.`);
      setSelectedIds(new Set());
      setBulkActionDlg({ open: false, type: null });
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Falha ao auditar notas em massa');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const ids = Array.from(selectedIds);
      const promises = ids.map(id => 
        supabase.rpc('soft_delete_fiscal_document', { 
          doc_id: id,
          user_id: user.id
        })
      );

      const results = await Promise.all(promises);
      const errors = results.filter(r => r.error);
      
      if (errors.length > 0) {
        toast.error(`${errors.length} notas falharam ao ser excluídas.`);
      }

      toast.success(`${ids.length - errors.length} notas excluídas com sucesso.`);
      setSelectedIds(new Set());
      setBulkActionDlg({ open: false, type: null });
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Falha ao excluir notas em massa');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePrint = async () => {
    if (rows.length === 0) { toast.error('Nenhum resultado para imprimir.'); return; }
    if (rows.length > 1000) {
      if (!window.confirm(`Relatório contém ${rows.length} registros. Continuar?`)) return;
    }
    try {
      downloadImportedNotesSummaryPdf({
        reportType,
        carrier: {
          name: companyProfile?.legal_name || companyProfile?.trade_name || currentTenant?.name || 'Transportadora',
          cnpj: companyProfile?.tax_id,
          ie: companyProfile?.state_registration,
          address: companyProfile?.address,
          city: companyProfile?.city,
          state: companyProfile?.state,
          phone: companyProfile?.phone,
          email: companyProfile?.email,
          website: companyProfile?.website,
          logo_data_url: companyProfile?.logo_data_url,
        },
        manifest: null,
        rows,
      });
      await createSummaryReportSnapshot(currentTenant!.id, reportType, reportType !== 'raw_list', applied, rows);
      toast.success('Relatório gerado');
      setPrintDlgOpen(false);
    } catch (e: any) {
      toast.error(e.message || 'Falha ao gerar PDF');
    }
  };

  const handleCsv = () => {
    if (rows.length === 0) { toast.error('Nenhum resultado para exportar.'); return; }
    const csv = exportImportedNotesCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `nfs_importadas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleXlsx = () => {
    if (rows.length === 0) { toast.error('Nenhum resultado para exportar.'); return; }
    try {
      downloadImportedNotesXlsx(rows);
      toast.success('Planilha gerada — pronta para enviar ao cliente.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao gerar a planilha.');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Resumo NF Importadas</h1>
          <p className="text-sm text-muted-foreground">
            Consulte notas fiscais importadas e gere o Manifesto de Carga operacional.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Nº Nota</Label><Input value={filters.invoiceNumber || ''} onChange={e => set('invoiceNumber', e.target.value)} placeholder="Ex: 12345" /></div>
          <div><Label>Lote Controle</Label><Input value={filters.controlLot || ''} onChange={e => set('controlLot', e.target.value)} /></div>
          <div><Label>Lote Dinâmico</Label><Input value={filters.dynamicLot || ''} onChange={e => set('dynamicLot', e.target.value)} /></div>
          <div><Label>Emissão de</Label><Input type="date" value={filters.issueFrom || ''} onChange={e => set('issueFrom', e.target.value)} /></div>
          <div><Label>Emissão até</Label><Input type="date" value={filters.issueTo || ''} onChange={e => set('issueTo', e.target.value)} /></div>
          <div><Label>Importação de</Label><Input type="date" value={filters.importFrom || ''} onChange={e => set('importFrom', e.target.value)} /></div>
          <div><Label>Importação até</Label><Input type="date" value={filters.importTo || ''} onChange={e => set('importTo', e.target.value)} /></div>
          <div><Label>Remetente</Label><Input value={filters.remitter || ''} onChange={e => set('remitter', e.target.value)} /></div>
          <div>
            <Label>Cliente</Label>
            <Select value={filters.clientId || '__all__'} onValueChange={(v) => set('clientId', v === '__all__' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fornecedor</Label>
            <Select value={filters.supplierId || '__all__'} onValueChange={(v) => set('supplierId', v === '__all__' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {clients.filter(c => c.is_supplier).map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Município Origem</Label><Input value={filters.originCity || ''} onChange={e => set('originCity', e.target.value)} /></div>
          <div><Label>Município Destino</Label><Input value={filters.destinationCity || ''} onChange={e => set('destinationCity', e.target.value)} /></div>
          <div>
            <Label>Situação NFS</Label>
            <Select value={filters.status || 'all'} onValueChange={(v) => set('status', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(Object.keys(NOTE_STATUS_LABELS) as NoteOperationalStatus[]).map(k => (
                  <SelectItem key={k} value={k}>{NOTE_STATUS_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Agrupado</Label>
            <Select value={filters.grouped ? 'yes' : 'no'} onValueChange={(v) => set('grouped', v === 'yes')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Sim</SelectItem>
                <SelectItem value="no">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4 flex flex-wrap gap-2 pt-2">
            <Button onClick={doSearch}><Search className="h-4 w-4 mr-2" />Buscar</Button>
            <Button variant="outline" onClick={doClear}><X className="h-4 w-4 mr-2" />Limpar filtros</Button>
            <Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" />Atualizar</Button>
            <div className="flex-1" />
            {selectedIds.size > 0 && (
              <div className="flex gap-2 mr-4 bg-muted/50 p-1 px-2 rounded-md border animate-in fade-in zoom-in duration-200">
                <span className="text-sm font-medium self-center mr-2">{selectedIds.size} selecionadas</span>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => setBulkActionDlg({ open: true, type: 'audit' })}
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />Auditar Massa
                </Button>
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={() => setBulkActionDlg({ open: true, type: 'delete' })}
                >
                  <Trash2 className="h-4 w-4 mr-2" />Excluir Massa
                </Button>
              </div>
            )}
            <Button variant="outline" onClick={handleCsv} disabled={rows.length === 0}><Download className="h-4 w-4 mr-2" />Exportar CSV</Button>
            <Button variant="outline" onClick={handleXlsx} disabled={rows.length === 0}><FileSpreadsheet className="h-4 w-4 mr-2" />Exportar Excel (Cliente)</Button>
            <Button onClick={() => setPrintDlgOpen(true)} disabled={rows.length === 0}><Printer className="h-4 w-4 mr-2" />Imprimir</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Notas" value={String(totals.rowCount)} />
        <KPI label="Valor NF" value={brl(totals.totalValue)} />
        <KPI label="Peso (kg)" value={num3(totals.totalWeight)} />
        <KPI label="Volume" value={num3(totals.totalVolume)} />
        <KPI label="Frete CIF" value={brl(totals.totalCif)} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Resultados</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox 
                    checked={rows.length > 0 && selectedIds.size === rows.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead sortKey="invoice_number" sortConfig={sortConfig} onSort={requestSort}>Nº Nota</TableHead>
                <TableHead sortKey="control_lot" sortConfig={sortConfig} onSort={requestSort}>Lote Imp.</TableHead>
                <TableHead sortKey="remitter" sortConfig={sortConfig} onSort={requestSort}>Remetente</TableHead>
                <TableHead sortKey="recipient" sortConfig={sortConfig} onSort={requestSort}>Destinatário</TableHead>
                <TableHead sortKey="cte_number" sortConfig={sortConfig} onSort={requestSort}>Nº CT-e</TableHead>
                <TableHead sortKey="nfse_number" sortConfig={sortConfig} onSort={requestSort}>Nº NFS-e</TableHead>
                <TableHead sortKey="issue_date" sortConfig={sortConfig} onSort={requestSort}>Emissão</TableHead>
                <TableHead sortKey="origin_city" sortConfig={sortConfig} onSort={requestSort}>Origem</TableHead>
                <TableHead sortKey="recipient_city" sortConfig={sortConfig} onSort={requestSort}>Destino</TableHead>
                <TableHead className="text-right" sortKey="value" sortConfig={sortConfig} onSort={requestSort}>Valor NF</TableHead>
                <TableHead className="text-right" sortKey="weight_kg" sortConfig={sortConfig} onSort={requestSort}>Peso</TableHead>
                <TableHead className="text-right" sortKey="volume_count" sortConfig={sortConfig} onSort={requestSort}>Volume</TableHead>
                <TableHead className="text-right" sortKey="freight_cif_value" sortConfig={sortConfig} onSort={requestSort}>CIF</TableHead>
                <TableHead className="text-right" sortKey="freight_fob_value" sortConfig={sortConfig} onSort={requestSort}>FOB</TableHead>
                <TableHead sortKey="operational_status" sortConfig={sortConfig} onSort={requestSort}>Situação</TableHead>
                <TableHead sortKey="loads.load_number" sortConfig={sortConfig} onSort={requestSort}>Carga</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={17} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={17} className="text-center text-muted-foreground">Nenhuma nota encontrada.</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow 
                  key={r.id} 
                  className={`cursor-pointer hover:bg-muted/50 ${selectedIds.has(r.id) ? 'bg-primary/5' : ''}`}
                  onClick={() => setDetailRow(r)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox 
                      checked={selectedIds.has(r.id)} 
                      onCheckedChange={() => toggleSelect(r.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.invoice_number || '—'}</TableCell>
                  <TableCell>{r.import_batch_id || r.control_lot || '—'}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{r.remitter || '—'}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{r.recipient || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.cte_number || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.nfse_number || '—'}</TableCell>
                  <TableCell>{dt(r.issue_date)}</TableCell>
                  <TableCell>{r.origin_city ? `${r.origin_city}${r.origin_state ? '/' + r.origin_state : ''}` : '—'}</TableCell>
                  <TableCell>{r.recipient_city ? `${r.recipient_city}${r.recipient_state ? '/' + r.recipient_state : ''}` : '—'}</TableCell>
                  <TableCell className="text-right">{brl(r.value)}</TableCell>
                  <TableCell className="text-right">{num3(r.weight_kg)}</TableCell>
                  <TableCell className="text-right">{num3(r.volume_count ?? r.pallet_count)}</TableCell>
                  <TableCell className="text-right">{brl(r.freight_cif_value ?? r.freight_value)}</TableCell>
                  <TableCell className="text-right">{brl(r.freight_fob_value)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.operational_status] || 'outline'}>{NOTE_STATUS_LABELS[r.operational_status]}</Badge></TableCell>
                  <TableCell>
                    {r.loads?.load_number
                      ? <Button variant="link" size="sm" className="h-auto p-0" onClick={(e) => { e.stopPropagation(); navigate(`/loads/${r.load_id}`); }}>{r.loads.load_number}</Button>
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={printDlgOpen} onOpenChange={setPrintDlgOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Escolha uma opção de relatório para impressão</DialogTitle></DialogHeader>
          <RadioGroup value={reportType} onValueChange={(v) => setReportType(v as SummaryReportType)}>
            <div className="flex items-start gap-2 p-2 rounded hover:bg-muted">
              <RadioGroupItem value="destination_summary" id="rt-dest" className="mt-1" />
              <div><Label htmlFor="rt-dest" className="font-medium">Resumo Notas Destino</Label>
                <p className="text-xs text-muted-foreground">Agrupa por município de destino, com subtotais por cidade.</p></div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded hover:bg-muted">
              <RadioGroupItem value="origin_summary" id="rt-orig" className="mt-1" />
              <div><Label htmlFor="rt-orig" className="font-medium">Resumo Notas Origem</Label>
                <p className="text-xs text-muted-foreground">Agrupa por município de origem, com subtotais.</p></div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded hover:bg-muted">
              <RadioGroupItem value="raw_list" id="rt-raw" className="mt-1" />
              <div><Label htmlFor="rt-raw" className="font-medium">Lista simples</Label>
                <p className="text-xs text-muted-foreground">Sem agrupamento por cidade.</p></div>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintDlgOpen(false)}>Cancelar</Button>
            <Button onClick={handlePrint}><Printer className="h-4 w-4 mr-2" />Gerar PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Detalhe da NF {detailRow?.invoice_number}</SheetTitle></SheetHeader>
          {detailRow && (
            <div className="space-y-3 py-4 text-sm">
              <DetailRow label="Chave de acesso" value={detailRow.access_key || '—'} mono />
              <DetailRow label="Remetente" value={detailRow.remitter || '—'} />
              <DetailRow label="Destinatário" value={detailRow.recipient || '—'} />
              <DetailRow label="Cliente" value={detailRow.clients?.company_name || '—'} />
              <DetailRow label="Fornecedor" value={detailRow.suppliers?.company_name || '—'} />
              <DetailRow label="Origem" value={detailRow.origin_city ? `${detailRow.origin_city}/${detailRow.origin_state || '--'}` : '—'} />
              <DetailRow label="Destino" value={detailRow.recipient_city ? `${detailRow.recipient_city}/${detailRow.recipient_state || '--'}` : '—'} />
              <DetailRow label="Valor" value={brl(detailRow.value)} />
              <DetailRow label="Peso" value={`${num3(detailRow.weight_kg)} kg`} />
              <DetailRow label="Volume" value={num3(detailRow.volume_count ?? detailRow.pallet_count)} />
              <DetailRow label="Situação" value={NOTE_STATUS_LABELS[detailRow.operational_status]} />
              <DetailRow label="Data emissão" value={dt(detailRow.issue_date)} />
              <DetailRow label="Data importação" value={dt(detailRow.imported_at || detailRow['created_at' as any])} />
              <div className="flex flex-wrap gap-2 pt-2">
                <Button 
                  size="sm" 
                  variant="default" 
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => handleAudit(detailRow)}
                  disabled={false}
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />Auditar
                </Button>
                {detailRow.load_id && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/loads/${detailRow.load_id}`)}>
                    <PackageCheck className="h-4 w-4 mr-2" />Abrir Carga
                  </Button>
                )}
                {detailRow.cte_id && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/cte-monitor?cte=${detailRow.cte_id}`)}>
                    <FileText className="h-4 w-4 mr-2" />Abrir CT-e
                  </Button>
                )}
                <Button 
                  size="sm" 
                  variant="destructive"
                  onClick={() => setDeleteId(detailRow.id)}
                  disabled={false}
                  title=""
                >
                  <Trash2 className="h-4 w-4 mr-2" />Excluir
                </Button>
              </div>
              {detailRow.delivery_meta && Object.keys(detailRow.delivery_meta).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Observações / delivery_meta</div>
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40">{JSON.stringify(detailRow.delivery_meta, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta nota fiscal? Esta ação não pode ser desfeita e removerá a nota permanentemente do sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? "Excluindo..." : "Confirmar Exclusão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog 
        open={bulkActionDlg.open} 
        onOpenChange={(open) => !open && setBulkActionDlg({ open: false, type: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkActionDlg.type === 'audit' ? 'Auditar em massa' : 'Excluir em massa'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkActionDlg.type === 'audit' 
                ? `Deseja auditar as ${selectedIds.size} notas selecionadas? O status será alterado para processado.`
                : `Tem certeza que deseja excluir as ${selectedIds.size} notas selecionadas? Esta ação removerá as notas permanentemente e as arquivará no histórico.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { 
                e.preventDefault(); 
                bulkActionDlg.type === 'audit' ? handleBulkAudit() : handleBulkDelete(); 
              }}
              className={bulkActionDlg.type === 'delete' ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              disabled={isDeleting}
            >
              {isDeleting ? "Processando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </CardContent></Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`col-span-2 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}