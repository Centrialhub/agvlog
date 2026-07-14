import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Boxes, Download, Upload, FileText, Plus, Trash2, CheckCircle2, XCircle, RefreshCw, Package, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { useClients } from '@/hooks/useClients';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import {
  usePalletTypes, usePalletProtocols, useCreatePalletProtocol,
  useUpdatePalletStatus, useCancelPalletProtocol, useUpsertPalletType,
  useImportPalletReturns, useAttachPalletProof, getPalletProofSignedUrl,
  useEditPalletProtocol,
  type PalletFilters, type PalletProtocol,
} from '@/hooks/usePalletReturns';
import {
  parsePalletReturnSheet, type ParsedPalletReturn,
} from '@/lib/palletReturns/palletReturnImporter';
import { generatePalletReturnProtocolPdf, generatePalletReportPdf, downloadBlob } from '@/lib/palletReturns/palletReturnPdf';
import { protocolsToCsv, rowsToCsv, downloadCsv } from '@/lib/palletReturns/palletReturnCsv';
import { protocolsToExcel } from '@/lib/palletReturns/palletReturnExcel';
import { buildSupplierReport, buildMonthlyReport, buildPalletTypeRanking, pendingProtocols, daysSince, totalsByPalletType } from '@/lib/palletReturns/palletReturnReports';
import { fmtDateSafe } from '@/lib/utils/formatDate';

const STATUS_LABEL: Record<PalletProtocol['status'], string> = {
  draft: 'Rascunho',
  scheduled: 'Programado',
  returned: 'Devolvido',
  partially_returned: 'Parcialmente devolvido',
  awaiting_signature: 'Aguardando assinatura',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

function StatusBadge({ status }: { status: PalletProtocol['status'] }) {
  const map: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    scheduled: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
    returned: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
    partially_returned: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
    awaiting_signature: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
    confirmed: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    cancelled: 'bg-red-500/20 text-red-700 dark:text-red-300',
  };
  return <Badge variant="outline" className={map[status] || ''}>{STATUS_LABEL[status]}</Badge>;
}

interface NewItem { pallet_type_id?: string; code: string; name: string; color?: string; quantity: number; notes?: string }

export default function PalletReturns() {
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const { data: company } = useCompanyProfile();
  const [filters, setFilters] = useState<PalletFilters>({});
  const { data: types = [] } = usePalletTypes(false);
  const { data: activeTypes = [] } = usePalletTypes(true);
  const { data: protocols = [], isLoading } = usePalletProtocols(filters);
  const { data: clients = [] } = useClients();
  const createMut = useCreatePalletProtocol();
  const statusMut = useUpdatePalletStatus();
  const cancelMut = useCancelPalletProtocol();
  const upsertType = useUpsertPalletType();
  const importMut = useImportPalletReturns();
  const attachMut = useAttachPalletProof();
  const editMut = useEditPalletProtocol();

  // ---- New protocol form ----
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierName, setSupplierName] = useState('');
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [returnDate, setReturnDate] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [driverName, setDriverName] = useState('');
  const [plate, setPlate] = useState('');
  const [items, setItems] = useState<NewItem[]>([]);
  const [initialStatus, setInitialStatus] = useState<PalletProtocol['status']>('draft');

  const addItem = () => {
    const t = activeTypes[0];
    setItems((p) => [...p, { pallet_type_id: t?.id, code: t?.code || '', name: t?.name || '', color: t?.color || undefined, quantity: 1 }]);
  };
  const removeItem = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i));

  const totalNewItems = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  const resetForm = () => {
    setSupplierId(''); setSupplierName(''); setReturnDate(''); setNotes('');
    setDriverName(''); setPlate(''); setItems([]); setInitialStatus('draft');
  };

  const submitProtocol = async (status: PalletProtocol['status']) => {
    if (!supplierName.trim() && !supplierId) { toast({ title: 'Fornecedor obrigatório', variant: 'destructive' }); return; }
    if (!issueDate) { toast({ title: 'Data obrigatória', variant: 'destructive' }); return; }
    if (items.length === 0) { toast({ title: 'Adicione ao menos 1 item', variant: 'destructive' }); return; }
    if (items.some((i) => !i.code || !i.name || !i.quantity || i.quantity <= 0)) {
      toast({ title: 'Itens inválidos', description: 'Cada item precisa de tipo, nome e quantidade > 0', variant: 'destructive' }); return;
    }
    if (status === 'confirmed' && !returnDate) { toast({ title: 'Data de devolução obrigatória para confirmar', variant: 'destructive' }); return; }

    const client = clients.find((c: any) => c.id === supplierId);
    try {
      const res = await createMut.mutateAsync({
        supplier_id: supplierId || null,
        supplier_name_snapshot: client?.company_name || supplierName,
        issue_date: issueDate,
        returned_at: returnDate || null,
        status,
        driver_name_snapshot: driverName || null,
        vehicle_plate_snapshot: plate || null,
        notes: notes || null,
        items: items.map((i, idx) => ({
          pallet_type_id: i.pallet_type_id || null,
          pallet_type_code: i.code, pallet_type_name: i.name,
          pallet_color: i.color || null, quantity: Number(i.quantity), notes: i.notes || null, sort_order: idx,
        })),
      });
      toast({ title: `Protocolo ${res.protocol_number} criado`, description: `Total: ${res.total_quantity} paletes` });
      resetForm();
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const totals = totalsByPalletType(protocols);
    const pending = pendingProtocols(protocols);
    return {
      totalPallets: protocols.reduce((s, p) => s + (p.total_quantity || 0), 0),
      totalProtocols: protocols.length,
      pending: pending.length,
      confirmed: protocols.filter((p) => p.status === 'confirmed').length,
      pbr: totals['PBR'] || 0,
      chep: totals['CHEP'] || 0,
      others: Object.entries(totals).filter(([k]) => !['PBR', 'CHEP'].includes(k)).reduce((s, [, v]) => s + v, 0),
    };
  }, [protocols]);

  const suppliersRep = useMemo(() => buildSupplierReport(protocols), [protocols]);
  const monthlyRep = useMemo(() => buildMonthlyReport(protocols), [protocols]);
  const rankingRep = useMemo(() => buildPalletTypeRanking(protocols), [protocols]);
  const pendingRep = useMemo(() => pendingProtocols(protocols), [protocols]);

  // ---- Import ----
  const [previewList, setPreviewList] = useState<ParsedPalletReturn[]>([]);
  const [importStatus, setImportStatus] = useState<'confirmed' | 'returned'>('confirmed');
  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePalletReturnSheet(buf, file.name);
      setPreviewList([parsed]);
    } catch (e: any) {
      toast({ title: 'Erro ao ler planilha', description: e?.message, variant: 'destructive' });
    }
  };
  const commitImport = async () => {
    const valid = previewList.filter((p) => p.supplier && p.issueDate && p.items.length > 0);
    if (valid.length === 0) { toast({ title: 'Nada para importar', variant: 'destructive' }); return; }
    try {
      const res = await importMut.mutateAsync({
        fileName: 'importacao',
        asStatus: importStatus,
        parsedList: valid.map((p) => ({
          supplier: p.supplier!, issueDate: p.issueDate!,
          items: p.items.map((i) => ({ code: i.code, name: i.name, quantity: i.quantity })),
          totalDeclared: p.totalDeclared,
        })),
      });
      toast({ title: 'Importação concluída', description: `${res.imported} importados, ${res.errors.length} erros` });
      setPreviewList([]);
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message, variant: 'destructive' });
    }
  };

  // ---- Dialogs ----
  const [detail, setDetail] = useState<PalletProtocol | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PalletProtocol | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [attachTarget, setAttachTarget] = useState<PalletProtocol | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [signatureDate, setSignatureDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [proofFile, setProofFile] = useState<File | null>(null);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<PalletProtocol | null>(null);
  const [editSupplierName, setEditSupplierName] = useState('');
  const [editIssueDate, setEditIssueDate] = useState('');
  const [editReturnDate, setEditReturnDate] = useState('');
  const [editDriver, setEditDriver] = useState('');
  const [editPlate, setEditPlate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editItems, setEditItems] = useState<NewItem[]>([]);

  const openEdit = (p: PalletProtocol) => {
    setEditTarget(p);
    setEditSupplierName(p.supplier_name_snapshot || '');
    setEditIssueDate(p.issue_date?.slice(0, 10) || '');
    setEditReturnDate(p.returned_at?.slice(0, 10) || '');
    setEditDriver(p.driver_name_snapshot || '');
    setEditPlate(p.vehicle_plate_snapshot || '');
    setEditNotes(p.notes || '');
    setEditReason('');
    setEditItems((p.items || []).map((i) => ({
      pallet_type_id: i.pallet_type_id || undefined,
      code: i.pallet_type_code, name: i.pallet_type_name,
      color: i.pallet_color || undefined, quantity: i.quantity, notes: i.notes || undefined,
    })));
  };

  const editTotal = editItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editSupplierName.trim()) { toast({ title: 'Fornecedor obrigatório', variant: 'destructive' }); return; }
    if (!editIssueDate) { toast({ title: 'Data obrigatória', variant: 'destructive' }); return; }
    if (editItems.length === 0) { toast({ title: 'Adicione ao menos 1 item', variant: 'destructive' }); return; }
    if (editItems.some((i) => !i.code || !i.name || !i.quantity || i.quantity <= 0)) {
      toast({ title: 'Itens inválidos', variant: 'destructive' }); return;
    }
    try {
      await editMut.mutateAsync({
        protocolId: editTarget.id,
        patch: {
          supplier_name_snapshot: editSupplierName,
          issue_date: editIssueDate,
          returned_at: editReturnDate || null,
          driver_name_snapshot: editDriver || null,
          vehicle_plate_snapshot: editPlate || null,
          notes: editNotes || null,
        },
        items: editItems.map((i, idx) => ({
          pallet_type_id: i.pallet_type_id || null,
          pallet_type_code: i.code, pallet_type_name: i.name,
          pallet_color: i.color || null, quantity: Number(i.quantity), notes: i.notes || null, sort_order: idx,
        })),
        reason: editReason || null,
      });
      toast({ title: 'Protocolo atualizado' });
      setEditTarget(null);
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  const printProtocol = (p: PalletProtocol) => {
    const blob = generatePalletReturnProtocolPdf(p, {
      companyName: company?.legal_name || company?.trade_name || currentTenant?.name,
      tenantName: currentTenant?.name,
      companyLegalName: company?.legal_name,
      companyTradeName: company?.trade_name,
      companyTaxId: company?.tax_id,
      companyAddress: [company?.address, company?.city, company?.state].filter(Boolean).join(' - '),
      companyPhone: company?.phone,
      companyEmail: company?.email,
      logoDataUrl: company?.logo_data_url,
    });
    downloadBlob(blob, `${p.protocol_number}.pdf`);
  };

  const changeStatus = async (p: PalletProtocol, status: PalletProtocol['status'], payload: Record<string, unknown> = {}) => {
    try {
      await statusMut.mutateAsync({ protocolId: p.id, status, payload });
      toast({ title: 'Status atualizado', description: STATUS_LABEL[status] });
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" /> Devolução de Paletes
          </h1>
          <p className="text-sm text-muted-foreground">Controle de devoluções, protocolos e relatórios por fornecedor</p>
        </div>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Lançamentos</TabsTrigger>
          <TabsTrigger value="new">Novo Lançamento</TabsTrigger>
          <TabsTrigger value="protocols">Protocolos</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
          <TabsTrigger value="types">Tipos de Palete</TabsTrigger>
          <TabsTrigger value="import">Importar Legado</TabsTrigger>
        </TabsList>

        {/* --- List / KPIs --- */}
        <TabsContent value="list" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              ['Total paletes', kpis.totalPallets],
              ['Protocolos', kpis.totalProtocols],
              ['Pendentes', kpis.pending],
              ['Confirmados', kpis.confirmed],
              ['PBR', kpis.pbr],
              ['CHEP', kpis.chep],
              ['Outros', kpis.others],
            ].map(([label, value]) => (
              <Card key={label as string}><CardContent className="p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-xl font-bold">{value}</div>
              </CardContent></Card>
            ))}
          </div>

          <Card><CardContent className="p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
            <Input placeholder="Fornecedor" value={filters.supplierName || ''} onChange={(e) => setFilters({ ...filters, supplierName: e.target.value })} />
            <Input placeholder="Nº protocolo" value={filters.protocolNumber || ''} onChange={(e) => setFilters({ ...filters, protocolNumber: e.target.value })} />
            <Input type="date" value={filters.fromIssue || ''} onChange={(e) => setFilters({ ...filters, fromIssue: e.target.value })} />
            <Input type="date" value={filters.toIssue || ''} onChange={(e) => setFilters({ ...filters, toIssue: e.target.value })} />
            <Select value={filters.status || '__all__'} onValueChange={(v) => setFilters({ ...filters, status: v === '__all__' ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os status</SelectItem>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={filters.palletTypeCode || '__all__'} onValueChange={(v) => setFilters({ ...filters, palletTypeCode: v === '__all__' ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os tipos</SelectItem>
                {types.map((t) => (<SelectItem key={t.id} value={t.code}>{t.code}</SelectItem>))}
              </SelectContent>
            </Select>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nº</TableHead><TableHead>Lançamento</TableHead><TableHead>Devolução</TableHead>
                <TableHead>Fornecedor</TableHead><TableHead>Total</TableHead><TableHead>Tipos</TableHead>
                <TableHead>Status</TableHead><TableHead>Motorista/Placa</TableHead><TableHead className="text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading && (<TableRow><TableCell colSpan={9} className="text-center text-muted-foreground p-6">Carregando...</TableCell></TableRow>)}
                {!isLoading && protocols.length === 0 && (<TableRow><TableCell colSpan={9} className="text-center text-muted-foreground p-6">Nenhum protocolo encontrado</TableCell></TableRow>)}
                {protocols.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => setDetail(p)}>
                    <TableCell className="font-mono text-xs">{p.protocol_number}</TableCell>
                    <TableCell>{p.issue_date ? fmtDateSafe(p.issue_date) : ''}</TableCell>
                    <TableCell>{p.returned_at ? fmtDateSafe(p.returned_at) : '—'}</TableCell>
                    <TableCell>{p.supplier_name_snapshot}</TableCell>
                    <TableCell className="font-semibold">{p.total_quantity}</TableCell>
                    <TableCell className="text-xs">{(p.items || []).map((i) => `${i.pallet_type_code}:${i.quantity}`).join(' · ')}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-xs">{[p.driver_name_snapshot, p.vehicle_plate_snapshot].filter(Boolean).join(' • ')}</TableCell>
                    <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => printProtocol(p)} title="PDF"><FileText className="h-4 w-4" /></Button>
                      {p.status !== 'confirmed' && p.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                      )}
                      {p.status !== 'confirmed' && p.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => changeStatus(p, 'returned')} title="Marcar devolvido"><RefreshCw className="h-4 w-4" /></Button>
                      )}
                      {p.status !== 'confirmed' && p.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => setAttachTarget(p)} title="Comprovante"><Upload className="h-4 w-4" /></Button>
                      )}
                      {['returned','partially_returned','awaiting_signature'].includes(p.status) && (
                        <Button variant="ghost" size="sm" onClick={() => changeStatus(p, 'confirmed')} title="Confirmar"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button>
                      )}
                      {p.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => { setCancelTarget(p); setCancelReason(''); }} title="Cancelar"><XCircle className="h-4 w-4 text-red-600" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* --- New --- */}
        <TabsContent value="new" className="space-y-4">
          <Card><CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Fornecedor / Cliente</Label>
                <Select value={supplierId || '__manual__'} onValueChange={(v) => { setSupplierId(v === '__manual__' ? '' : v); if (v !== '__manual__') setSupplierName(clients.find((c: any) => c.id === v)?.company_name || ''); }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">— Digitar manualmente —</SelectItem>
                    {clients.map((c: any) => (<SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>))}
                  </SelectContent>
                </Select>
                {!supplierId && (<Input className="mt-2" placeholder="Nome do fornecedor" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />)}
              </div>
              <div><Label>Data do lançamento</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
              <div><Label>Data efetiva de devolução</Label><Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></div>
              <div><Label>Motorista</Label><Input value={driverName} onChange={(e) => setDriverName(e.target.value)} /></div>
              <div><Label>Placa</Label><Input value={plate} onChange={(e) => setPlate(e.target.value)} /></div>
              <div><Label>Status inicial</Label>
                <Select value={initialStatus} onValueChange={(v) => setInitialStatus(v as PalletProtocol['status'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['draft','scheduled','returned'].map((s) => (<SelectItem key={s} value={s}>{STATUS_LABEL[s as PalletProtocol['status']]}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3"><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            </div>

            <div className="border rounded-md">
              <div className="p-3 flex items-center justify-between border-b">
                <div className="font-semibold flex items-center gap-2"><Package className="h-4 w-4" /> Itens do protocolo</div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Total: <strong>{totalNewItems}</strong></span>
                  <Button size="sm" onClick={addItem}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                </div>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Cor</TableHead><TableHead>Qtd</TableHead><TableHead>Obs</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {items.length === 0 && (<TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">Nenhum item</TableCell></TableRow>)}
                  {items.map((it, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Select value={it.pallet_type_id || '__manual__'} onValueChange={(v) => {
                          const t = activeTypes.find((x) => x.id === v);
                          setItems((p) => p.map((x, i) => i === idx ? ({ ...x, pallet_type_id: t?.id, code: t?.code || x.code, name: t?.name || x.name, color: t?.color || x.color }) : x));
                        }}>
                          <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__manual__">— Manual —</SelectItem>
                            {activeTypes.map((t) => (<SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>))}
                          </SelectContent>
                        </Select>
                        {!it.pallet_type_id && (
                          <div className="flex gap-1 mt-1">
                            <Input placeholder="Código" value={it.code} onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, code: e.target.value.toUpperCase() } : x))} />
                            <Input placeholder="Nome" value={it.name} onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                          </div>
                        )}
                      </TableCell>
                      <TableCell><Input value={it.color || ''} onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, color: e.target.value } : x))} /></TableCell>
                      <TableCell className="w-24"><Input type="number" min={1} value={it.quantity} onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} /></TableCell>
                      <TableCell><Input value={it.notes || ''} onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))} /></TableCell>
                      <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => removeItem(idx)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => submitProtocol('draft')}>Salvar rascunho</Button>
              <Button variant="outline" onClick={() => submitProtocol('returned')}>Marcar como devolvido</Button>
              <Button onClick={() => submitProtocol(initialStatus === 'draft' ? 'returned' : initialStatus)}>Salvar e gerar protocolo</Button>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* --- Protocols --- */}
        <TabsContent value="protocols" className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(protocolsToCsv(protocols), 'protocolos-paletes.csv')}><Download className="h-4 w-4 mr-1" /> CSV</Button>
            <Button size="sm" variant="outline" onClick={() => protocolsToExcel(protocols)}><Download className="h-4 w-4 mr-1" /> Excel</Button>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Protocolo</TableHead><TableHead>Fornecedor</TableHead><TableHead>Data</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Confirmado</TableHead><TableHead className="text-right">PDF</TableHead></TableRow></TableHeader>
              <TableBody>
                {protocols.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.protocol_number}</TableCell>
                    <TableCell>{p.supplier_name_snapshot}</TableCell>
                    <TableCell>{p.issue_date ? fmtDateSafe(p.issue_date) : ''}</TableCell>
                    <TableCell>{p.total_quantity}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell>{p.confirmed_at ? fmtDateSafe(p.confirmed_at) : '—'}</TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => printProtocol(p)}><FileText className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* --- Reports --- */}
        <TabsContent value="reports" className="space-y-6">
          <Card><CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Paletes devolvidos por fornecedor</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadCsv(rowsToCsv(['Fornecedor','Protocolos','Total','PBR','CHEP','Outros','Última devolução'], suppliersRep.map(r => [r.supplierName, r.totalProtocols, r.totalPallets, r.pbr, r.chep, r.others, r.lastReturnAt || ''])), 'paletes-por-fornecedor.csv')}><Download className="h-4 w-4 mr-1" /> CSV</Button>
                <Button size="sm" variant="outline" onClick={() => downloadBlob(generatePalletReportPdf('Paletes devolvidos por fornecedor', ['Fornecedor','Protocolos','Total','PBR','CHEP','Outros','Última'], suppliersRep.map(r => [r.supplierName, r.totalProtocols, r.totalPallets, r.pbr, r.chep, r.others, r.lastReturnAt || '']), { tenantName: currentTenant?.name, totals: [['Total paletes', kpis.totalPallets], ['PBR', kpis.pbr], ['CHEP', kpis.chep]] }), 'paletes-fornecedor.pdf')}><FileText className="h-4 w-4 mr-1" /> PDF</Button>
              </div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead>Protocolos</TableHead><TableHead>Total</TableHead><TableHead>PBR</TableHead><TableHead>CHEP</TableHead><TableHead>Outros</TableHead><TableHead>Última</TableHead></TableRow></TableHeader>
              <TableBody>
                {suppliersRep.map((r) => (
                  <TableRow key={r.supplierName}>
                    <TableCell>{r.supplierName}</TableCell><TableCell>{r.totalProtocols}</TableCell>
                    <TableCell className="font-semibold">{r.totalPallets}</TableCell>
                    <TableCell>{r.pbr}</TableCell><TableCell>{r.chep}</TableCell><TableCell>{r.others}</TableCell>
                    <TableCell>{r.lastReturnAt ? fmtDateSafe(r.lastReturnAt) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>

          <Card><CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Devoluções por mês / fornecedor / tipo</h3>
              <Button size="sm" variant="outline" onClick={() => downloadCsv(rowsToCsv(['Mês','Fornecedor','Tipo','Quantidade','Protocolos'], monthlyRep.map(r => [r.yearMonth, r.supplierName, r.palletType, r.quantity, r.protocols])), 'paletes-mensal.csv')}><Download className="h-4 w-4 mr-1" /> CSV</Button>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead>Fornecedor</TableHead><TableHead>Tipo</TableHead><TableHead>Qtd</TableHead><TableHead>Protocolos</TableHead></TableRow></TableHeader>
              <TableBody>{monthlyRep.map((r, i) => (<TableRow key={i}><TableCell>{r.yearMonth}</TableCell><TableCell>{r.supplierName}</TableCell><TableCell>{r.palletType}</TableCell><TableCell>{r.quantity}</TableCell><TableCell>{r.protocols}</TableCell></TableRow>))}</TableBody>
            </Table>
          </CardContent></Card>

          <Card><CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center"><h3 className="font-semibold">Ranking por tipo de palete</h3></div>
            <Table>
              <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Quantidade</TableHead><TableHead>Protocolos</TableHead><TableHead>Fornecedores</TableHead></TableRow></TableHeader>
              <TableBody>{rankingRep.map((r) => (<TableRow key={r.palletType}><TableCell className="font-mono">{r.palletType}</TableCell><TableCell className="font-semibold">{r.quantity}</TableCell><TableCell>{r.protocols}</TableCell><TableCell>{r.suppliers}</TableCell></TableRow>))}</TableBody>
            </Table>
          </CardContent></Card>

          <Card><CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center"><h3 className="font-semibold">Protocolos pendentes</h3></div>
            <Table>
              <TableHeader><TableRow><TableHead>Protocolo</TableHead><TableHead>Fornecedor</TableHead><TableHead>Data prevista</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Dias pendente</TableHead></TableRow></TableHeader>
              <TableBody>{pendingRep.map((p) => (<TableRow key={p.id}><TableCell className="font-mono text-xs">{p.protocol_number}</TableCell><TableCell>{p.supplier_name_snapshot}</TableCell><TableCell>{p.expected_return_date ? fmtDateSafe(p.expected_return_date) : '—'}</TableCell><TableCell>{p.total_quantity}</TableCell><TableCell><StatusBadge status={p.status} /></TableCell><TableCell>{daysSince(p.issue_date) ?? '—'}</TableCell></TableRow>))}</TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* --- Types --- */}
        <TabsContent value="types" className="space-y-3">
          <PalletTypesEditor onSave={(t) => upsertType.mutate(t)} types={types} />
        </TabsContent>

        {/* --- Import --- */}
        <TabsContent value="import" className="space-y-4">
          <Card><CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <Select value={importStatus} onValueChange={(v) => setImportStatus(v as any)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">Importar como confirmado</SelectItem>
                  <SelectItem value="returned">Importar como devolvido</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={commitImport} disabled={previewList.length === 0}>Importar</Button>
            </div>
            {previewList.map((p, idx) => (
              <Card key={idx} className="border-dashed"><CardContent className="p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <div><strong>Fornecedor:</strong> {p.supplier || <span className="text-red-600">não detectado</span>}</div>
                  <div><strong>Data:</strong> {p.issueDate || <span className="text-red-600">não detectada</span>}</div>
                </div>
                <Table><TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Qtd</TableHead></TableRow></TableHeader>
                  <TableBody>{p.items.map((i, j) => (<TableRow key={j}><TableCell>{i.name}</TableCell><TableCell>{i.quantity}</TableCell></TableRow>))}</TableBody>
                </Table>
                <div className="text-sm">Total calculado: <strong>{p.totalCalculated}</strong> {p.totalDeclared != null && (<>• Total informado: <strong>{p.totalDeclared}</strong> {p.hasTotalDivergence && (<Badge variant="destructive" className="ml-2">divergente</Badge>)}</>)}</div>
              </CardContent></Card>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Protocolo {detail?.protocol_number}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><strong>Fornecedor:</strong> {detail.supplier_name_snapshot}</div>
                <div><strong>Status:</strong> <StatusBadge status={detail.status} /></div>
                <div><strong>Data lançamento:</strong> {fmtDateSafe(detail.issue_date)}</div>
                <div><strong>Devolução:</strong> {detail.returned_at ? fmtDateSafe(detail.returned_at) : '—'}</div>
                <div><strong>Motorista:</strong> {detail.driver_name_snapshot || '—'}</div>
                <div><strong>Placa:</strong> {detail.vehicle_plate_snapshot || '—'}</div>
              </div>
              <div>
                <Table><TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Cor</TableHead><TableHead>Qtd</TableHead></TableRow></TableHeader>
                  <TableBody>{(detail.items || []).map((i) => (<TableRow key={i.id}><TableCell>{i.pallet_type_code} — {i.pallet_type_name}</TableCell><TableCell>{i.pallet_color || '—'}</TableCell><TableCell className="font-semibold">{i.quantity}</TableCell></TableRow>))}
                    <TableRow><TableCell colSpan={2} className="font-bold text-right">TOTAL</TableCell><TableCell className="font-bold">{detail.total_quantity}</TableCell></TableRow>
                  </TableBody></Table>
              </div>
              {detail.notes && (<div><strong>Observações:</strong> {detail.notes}</div>)}
              {detail.signed_proof_url && (
                <Button variant="link" size="sm" onClick={async () => { const url = await getPalletProofSignedUrl(detail.signed_proof_url!); if (url) window.open(url, '_blank'); }}>Abrir comprovante assinado</Button>
              )}
            </div>
          )}
          <DialogFooter>
            {detail && <Button variant="outline" onClick={() => printProtocol(detail)}><FileText className="h-4 w-4 mr-1" /> Baixar PDF</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent><DialogHeader><DialogTitle>Cancelar protocolo</DialogTitle></DialogHeader>
          <Textarea placeholder="Motivo do cancelamento" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Voltar</Button>
            <Button variant="destructive" onClick={async () => { if (!cancelTarget || !cancelReason.trim()) { toast({ title: 'Motivo obrigatório', variant: 'destructive' }); return; } try { await cancelMut.mutateAsync({ protocolId: cancelTarget.id, reason: cancelReason }); toast({ title: 'Cancelado' }); setCancelTarget(null); } catch (e: any) { toast({ title: 'Erro', description: e?.message, variant: 'destructive' }); } }}>Cancelar protocolo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach */}
      <Dialog open={!!attachTarget} onOpenChange={(o) => !o && setAttachTarget(null)}>
        <DialogContent><DialogHeader><DialogTitle>Anexar comprovante assinado</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Recebedor</Label><Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} /></div>
            <div><Label>Data assinatura</Label><Input type="date" value={signatureDate} onChange={(e) => setSignatureDate(e.target.value)} /></div>
            <div><Label>Arquivo (PDF ou imagem)</Label><Input type="file" accept="application/pdf,image/*" onChange={(e) => setProofFile(e.target.files?.[0] || null)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachTarget(null)}>Cancelar</Button>
            <Button onClick={async () => { if (!attachTarget || !proofFile) { toast({ title: 'Selecione um arquivo', variant: 'destructive' }); return; } try { await attachMut.mutateAsync({ protocolId: attachTarget.id, file: proofFile, receiverName, signatureDate }); toast({ title: 'Comprovante anexado' }); setAttachTarget(null); setProofFile(null); } catch (e: any) { toast({ title: 'Erro', description: e?.message, variant: 'destructive' }); } }}>Anexar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar protocolo {editTarget?.protocol_number}</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2"><Label>Fornecedor</Label><Input value={editSupplierName} onChange={(e) => setEditSupplierName(e.target.value)} /></div>
                <div><Label>Data lançamento</Label><Input type="date" value={editIssueDate} onChange={(e) => setEditIssueDate(e.target.value)} /></div>
                <div><Label>Data devolução</Label><Input type="date" value={editReturnDate} onChange={(e) => setEditReturnDate(e.target.value)} /></div>
                <div><Label>Motorista</Label><Input value={editDriver} onChange={(e) => setEditDriver(e.target.value)} /></div>
                <div><Label>Placa</Label><Input value={editPlate} onChange={(e) => setEditPlate(e.target.value)} /></div>
                <div className="md:col-span-3"><Label>Observações</Label><Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} /></div>
              </div>

              <div className="border rounded-md">
                <div className="p-3 flex items-center justify-between border-b">
                  <div className="font-semibold flex items-center gap-2"><Package className="h-4 w-4" /> Itens</div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">Total: <strong>{editTotal}</strong></span>
                    <Button size="sm" onClick={() => {
                      const t0 = activeTypes[0];
                      setEditItems((p) => [...p, { pallet_type_id: t0?.id, code: t0?.code || '', name: t0?.name || '', color: t0?.color || undefined, quantity: 1 }]);
                    }}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                  </div>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Cor</TableHead><TableHead>Qtd</TableHead><TableHead>Obs</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {editItems.length === 0 && (<TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">Nenhum item</TableCell></TableRow>)}
                    {editItems.map((it, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Select value={it.pallet_type_id || '__manual__'} onValueChange={(v) => {
                            const t0 = activeTypes.find((x) => x.id === v);
                            setEditItems((p) => p.map((x, i) => i === idx ? ({ ...x, pallet_type_id: t0?.id, code: t0?.code || x.code, name: t0?.name || x.name, color: t0?.color || x.color }) : x));
                          }}>
                            <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__manual__">— Manual —</SelectItem>
                              {activeTypes.map((t0) => (<SelectItem key={t0.id} value={t0.id}>{t0.code} — {t0.name}</SelectItem>))}
                            </SelectContent>
                          </Select>
                          {!it.pallet_type_id && (
                            <div className="flex gap-1 mt-1">
                              <Input placeholder="Código" value={it.code} onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, code: e.target.value.toUpperCase() } : x))} />
                              <Input placeholder="Nome" value={it.name} onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                            </div>
                          )}
                        </TableCell>
                        <TableCell><Input value={it.color || ''} onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, color: e.target.value } : x))} /></TableCell>
                        <TableCell className="w-24"><Input type="number" min={1} value={it.quantity} onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} /></TableCell>
                        <TableCell><Input value={it.notes || ''} onChange={(e) => setEditItems((p) => p.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))} /></TableCell>
                        <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setEditItems((p) => p.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <Label>Motivo da edição (opcional, registrado no histórico)</Label>
                <Textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} placeholder="Ex: correção de quantidade informada errada" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancelar</Button>
            <Button onClick={submitEdit} disabled={editMut.isPending}>Salvar alterações</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PalletTypesEditor({ types, onSave }: { types: any[]; onSave: (t: any) => void }) {
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [color, setColor] = useState(''); const [desc, setDesc] = useState('');
  return (
    <>
      <Card><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <div><Label>Código</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
          <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Cor</Label><Input value={color} onChange={(e) => setColor(e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Descrição</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        </div>
        <Button onClick={() => { if (!code || !name) return; onSave({ code, name, color: color || null, description: desc || null }); setCode(''); setName(''); setColor(''); setDesc(''); }}>Adicionar tipo</Button>
      </CardContent></Card>
      <Card><CardContent className="p-0">
        <Table><TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Cor</TableHead><TableHead>Ativo</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
          <TableBody>{types.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-mono">{t.code}</TableCell><TableCell>{t.name}</TableCell>
              <TableCell>{t.color || '—'}</TableCell>
              <TableCell>{t.is_active ? <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">Sim</Badge> : <Badge variant="outline">Não</Badge>}</TableCell>
              <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => onSave({ ...t, is_active: !t.is_active })}>{t.is_active ? 'Desativar' : 'Ativar'}</Button></TableCell>
            </TableRow>))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </>
  );
}