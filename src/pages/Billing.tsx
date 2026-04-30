import { useMemo, useState } from 'react';
import { useFiscalDocuments } from '@/hooks/useFiscalDocuments';
import { useClients } from '@/hooks/useClients';
import { useLoads, LOAD_STATUSES, LOAD_STATUS_LABELS } from '@/hooks/useLoads';
import { useCteBatches, useCreateCteBatch, useCancelCteBatch } from '@/hooks/useBilling';
import { GROUPING_MODES, buildGroups, getGroupingMode, type CteGroupPreview } from '@/lib/cteGroupingModes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FileSpreadsheet, Calculator, CheckCircle2, Layers, FileText, Info, XCircle, RotateCw, Filter, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const SENTINEL_NONE = '__none__';

type SourceTab = 'period' | 'loads';

// Tipos de operação espelhando o SIAT
const OPERATION_TYPES = [
  { value: 'filial', label: 'Filial' },
  { value: 'armazenagem', label: 'Armazenagem' },
  { value: 'frota', label: 'Frota' },
  { value: 'viagem_direta', label: 'Viagem Direta' },
  { value: 'retira', label: 'Retira' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'devolucao', label: 'Devolução' },
  { value: 'redespacho', label: 'Redespacho/Sub' },
] as const;

type OpType = typeof OPERATION_TYPES[number]['value'];

export default function Billing() {
  const { data: docs = [], isLoading: docsLoading } = useFiscalDocuments();
  const { data: clients = [] } = useClients();
  const { data: loads = [] } = useLoads();
  const { data: batches = [] } = useCteBatches();
  const createBatch = useCreateCteBatch();
  const cancelBatch = useCancelCteBatch();

  const [tab, setTab] = useState<SourceTab>('period');
  const [clientId, setClientId] = useState<string>(SENTINEL_NONE);
  const [periodStart, setPeriodStart] = useState<string>('');
  const [periodEnd, setPeriodEnd] = useState<string>('');
  const [selectedLoadIds, setSelectedLoadIds] = useState<Set<string>>(new Set());
  const [modeId, setModeId] = useState<number>(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [modeDialogOpen, setModeDialogOpen] = useState(false);

  // ===== Filtros avançados (SIAT) =====
  const [osNumber, setOsNumber] = useState('');
  const [collectOrder, setCollectOrder] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDateStart, setIssueDateStart] = useState('');
  const [issueDateEnd, setIssueDateEnd] = useState('');
  const [supplierManifest, setSupplierManifest] = useState('');
  const [distributionManifest, setDistributionManifest] = useState('');
  const [shipmentManifest, setShipmentManifest] = useState('');
  const [originManifest, setOriginManifest] = useState('');
  const [loadStatus, setLoadStatus] = useState<string>(SENTINEL_NONE);
  const [plate, setPlate] = useState('');
  const [scheduledLoadStart, setScheduledLoadStart] = useState('');
  const [scheduledLoadEnd, setScheduledLoadEnd] = useState('');
  const [actualLoadStart, setActualLoadStart] = useState('');
  const [actualLoadEnd, setActualLoadEnd] = useState('');
  const [supplier, setSupplier] = useState('');
  const [supplierCnpj, setSupplierCnpj] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [opTypes, setOpTypes] = useState<Set<OpType>>(new Set());
  const [allOps, setAllOps] = useState(true);

  const toggleOp = (op: OpType) => {
    setAllOps(false);
    setOpTypes(prev => {
      const next = new Set(prev);
      next.has(op) ? next.delete(op) : next.add(op);
      return next;
    });
  };

  const clearAdvanced = () => {
    setOsNumber(''); setCollectOrder(''); setReferenceNumber(''); setCnpj('');
    setInvoiceNumber(''); setIssueDateStart(''); setIssueDateEnd('');
    setSupplierManifest(''); setDistributionManifest(''); setShipmentManifest(''); setOriginManifest('');
    setLoadStatus(SENTINEL_NONE); setPlate('');
    setScheduledLoadStart(''); setScheduledLoadEnd(''); setActualLoadStart(''); setActualLoadEnd('');
    setSupplier(''); setSupplierCnpj(''); setAccessKey('');
    setOpTypes(new Set()); setAllOps(true);
  };

  const matchesOp = (opType: string | null | undefined) => {
    if (allOps || opTypes.size === 0) return true;
    return opType ? opTypes.has(opType as OpType) : false;
  };

  const ciIncludes = (haystack: string | null | undefined, needle: string) =>
    !needle || (haystack || '').toLowerCase().includes(needle.toLowerCase());

  // Filtra documentos elegíveis ao faturamento.
  const eligibleDocs = useMemo(() => {
    const realClient = clientId !== SENTINEL_NONE ? clientId : null;
    return docs.filter(d => {
      if (d.status === 'cancelled') return false;
      if (d.document_type !== 'inbound') return false; // Faturamos sobre entradas/notas do cliente
      if (realClient && d.client_id !== realClient) return false;
      if (tab === 'period') {
        if (periodStart && (!d.issue_date || d.issue_date < periodStart)) return false;
        if (periodEnd && (!d.issue_date || d.issue_date > periodEnd)) return false;
      } else {
        if (!d.load_id || !selectedLoadIds.has(d.load_id)) return false;
      }

      // Filtros SIAT (documento)
      if (issueDateStart && (!d.issue_date || d.issue_date < issueDateStart)) return false;
      if (issueDateEnd && (!d.issue_date || d.issue_date > issueDateEnd)) return false;
      if (!ciIncludes(d.invoice_number, invoiceNumber)) return false;
      if (!ciIncludes(d.access_key, accessKey)) return false;
      if (!ciIncludes(d.remitter, supplier)) return false;
      if (!ciIncludes((d as any).client_load_number, referenceNumber)) return false;

      // Filtros que dependem da carga associada
      const load = d.load_id ? loads.find(l => l.id === d.load_id) : null;
      if (osNumber && !ciIncludes(load?.trip_id, osNumber)) return false;
      if (collectOrder && !ciIncludes(load?.load_number, collectOrder)) return false;
      if (loadStatus !== SENTINEL_NONE && load?.status !== loadStatus) return false;
      if (plate && !ciIncludes(load?.vehicles?.plate, plate)) return false;
      if (supplierManifest && !ciIncludes(load?.supplier_manifest, supplierManifest)) return false;
      if (distributionManifest && !ciIncludes(load?.distribution_manifest, distributionManifest)) return false;
      if (shipmentManifest && !ciIncludes(load?.shipment_manifest, shipmentManifest)) return false;
      if (originManifest && !ciIncludes(load?.origin_manifest, originManifest)) return false;
      if (!matchesOp(load?.operation_type ?? (d as any).operation_type)) return false;

      return true;
    });
  }, [
    docs, loads, clientId, periodStart, periodEnd, tab, selectedLoadIds,
    osNumber, collectOrder, referenceNumber, invoiceNumber, accessKey, supplier,
    issueDateStart, issueDateEnd, supplierManifest, distributionManifest,
    shipmentManifest, originManifest, loadStatus, plate, opTypes, allOps,
  ]);

  const groups: CteGroupPreview[] = useMemo(
    () => buildGroups(eligibleDocs, modeId),
    [eligibleDocs, modeId],
  );

  const totals = useMemo(() => ({
    docs: eligibleDocs.length,
    cargo: eligibleDocs.reduce((s, d) => s + (Number(d.value) || 0), 0),
    freight: eligibleDocs.reduce((s, d) => s + (Number(d.freight_value) || 0), 0),
    pallets: eligibleDocs.reduce((s, d) => s + (d.pallet_count || 0), 0),
    weight: eligibleDocs.reduce((s, d) => s + (Number(d.weight_kg) || 0), 0),
  }), [eligibleDocs]);

  const billableLoads = useMemo(() => loads.filter(l =>
    clientId === SENTINEL_NONE ? true : docs.some(d => d.load_id === l.id && d.client_id === clientId)
  ), [loads, docs, clientId]);

  const toggleLoad = (id: string) => {
    setSelectedLoadIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (groups.length === 0) {
      toast.error('Nenhum documento elegível para faturar com os filtros atuais.');
      return;
    }
    try {
      await createBatch.mutateAsync({
        client_id: clientId !== SENTINEL_NONE ? clientId : null,
        grouping_mode: modeId,
        source_type: tab,
        period_start: tab === 'period' ? periodStart || null : null,
        period_end: tab === 'period' ? periodEnd || null : null,
        load_ids: tab === 'loads' ? Array.from(selectedLoadIds) : [],
        fiscal_document_ids: eligibleDocs.map(d => d.id),
        groups,
      });
      toast.success(`${groups.length} CT-e(s) gerados em rascunho. Sincronizado com Contas a Receber.`);
      setPreviewOpen(false);
      setSelectedLoadIds(new Set());
    } catch (e: any) {
      toast.error('Erro ao gerar CT-es', { description: e.message });
    }
  };

  const mode = getGroupingMode(modeId);

  const activeFilterCount = [
    osNumber, collectOrder, referenceNumber, cnpj, invoiceNumber,
    issueDateStart, issueDateEnd, supplierManifest, distributionManifest,
    shipmentManifest, originManifest, plate, scheduledLoadStart, scheduledLoadEnd,
    actualLoadStart, actualLoadEnd, supplier, supplierCnpj, accessKey,
  ].filter(Boolean).length
    + (loadStatus !== SENTINEL_NONE ? 1 : 0)
    + (!allOps && opTypes.size > 0 ? 1 : 0);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-primary" /> Faturamento (CT-e / Conhecimento)
          </h1>
          <p className="text-sm text-muted-foreground">
            Gere conhecimentos de transporte agrupando notas pelos 14 modos disponíveis. Os CT-es alimentam Contas a Receber automaticamente.
          </p>
        </div>
      </div>

      {/* Configuração */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Selecione a base de faturamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as SourceTab)}>
            <TabsList>
              <TabsTrigger value="period">Por cliente / período</TabsTrigger>
              <TabsTrigger value="loads">Por cargas</TabsTrigger>
            </TabsList>

            <TabsContent value="period" className="space-y-3 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Cliente</Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_NONE}>Todos os clientes</SelectItem>
                      {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Início</Label>
                  <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                </div>
                <div>
                  <Label>Fim</Label>
                  <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="loads" className="space-y-3 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Cliente (opcional)</Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_NONE}>Todos os clientes</SelectItem>
                      {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="rounded-md border max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Carga</TableHead>
                      <TableHead>Origem → Destino</TableHead>
                      <TableHead className="text-right">Pallets</TableHead>
                      <TableHead className="text-right">Peso (kg)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billableLoads.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhuma carga disponível</TableCell></TableRow>
                    ) : billableLoads.map(l => (
                      <TableRow key={l.id} className="cursor-pointer" onClick={() => toggleLoad(l.id)}>
                        <TableCell><Checkbox checked={selectedLoadIds.has(l.id)} /></TableCell>
                        <TableCell className="font-mono text-sm">{l.load_number}</TableCell>
                        <TableCell className="text-sm">{l.origin || '—'} → {l.destination || '—'}</TableCell>
                        <TableCell className="text-right text-sm">{l.total_pallet_count || 0}</TableCell>
                        <TableCell className="text-right text-sm">{Number(l.total_weight_kg || 0).toLocaleString('pt-BR')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Filtros avançados (SIAT) */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Filtros avançados (geração automática)
            {activeFilterCount > 0 && (
              <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/30">
                {activeFilterCount} ativo{activeFilterCount > 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={clearAdvanced} disabled={activeFilterCount === 0}>
            <Eraser className="h-4 w-4 mr-1" /> Limpar
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Field label="Nº OS"><Input value={osNumber} onChange={e => setOsNumber(e.target.value)} /></Field>
            <Field label="Ordem de Coleta"><Input value={collectOrder} onChange={e => setCollectOrder(e.target.value)} /></Field>
            <Field label="Nº Referência"><Input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} /></Field>
            <Field label="CNPJ Cliente"><Input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></Field>

            <Field label="Nota Fiscal"><Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></Field>
            <Field label="Emissão NF — Início"><Input type="date" value={issueDateStart} onChange={e => setIssueDateStart(e.target.value)} /></Field>
            <Field label="Emissão NF — Fim"><Input type="date" value={issueDateEnd} onChange={e => setIssueDateEnd(e.target.value)} /></Field>
            <Field label="Chave Acesso CT-e"><Input value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder="44 dígitos" /></Field>

            <Field label="Romaneio do Fornecedor"><Input value={supplierManifest} onChange={e => setSupplierManifest(e.target.value)} /></Field>
            <Field label="Romaneio de Distribuição"><Input value={distributionManifest} onChange={e => setDistributionManifest(e.target.value)} /></Field>
            <Field label="Romaneio de Expedição"><Input value={shipmentManifest} onChange={e => setShipmentManifest(e.target.value)} /></Field>
            <Field label="Romaneio Origem"><Input value={originManifest} onChange={e => setOriginManifest(e.target.value)} /></Field>

            <Field label="Status da Carga">
              <Select value={loadStatus} onValueChange={setLoadStatus}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SENTINEL_NONE}>Todos</SelectItem>
                  {LOAD_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{LOAD_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Placa"><Input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="ABC1D23" /></Field>
            <Field label="Fornecedor"><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></Field>
            <Field label="CNPJ Fornecedor"><Input value={supplierCnpj} onChange={e => setSupplierCnpj(e.target.value)} /></Field>

            <Field label="Carregamento Previsto — Início"><Input type="date" value={scheduledLoadStart} onChange={e => setScheduledLoadStart(e.target.value)} /></Field>
            <Field label="Carregamento Previsto — Fim"><Input type="date" value={scheduledLoadEnd} onChange={e => setScheduledLoadEnd(e.target.value)} /></Field>
            <Field label="Carregamento Real — Início"><Input type="date" value={actualLoadStart} onChange={e => setActualLoadStart(e.target.value)} /></Field>
            <Field label="Carregamento Real — Fim"><Input type="date" value={actualLoadEnd} onChange={e => setActualLoadEnd(e.target.value)} /></Field>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Tipos de operação</Label>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={allOps}
                  onCheckedChange={(v) => { setAllOps(!!v); if (v) setOpTypes(new Set()); }}
                />
                <span className="font-medium">Todos</span>
              </label>
              {OPERATION_TYPES.map(op => (
                <label key={op.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={!allOps && opTypes.has(op.value)}
                    onCheckedChange={() => toggleOp(op.value)}
                  />
                  <span>{op.label}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modo de agrupamento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> 2. Modo de geração do conhecimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="flex items-start gap-3 min-w-0">
              <Badge variant="outline" className="font-mono shrink-0">#{String(mode.id).padStart(2, '0')}</Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{mode.label}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">{mode.description}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setModeDialogOpen(true)}>
              Alterar modo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" /> 3. Prévia do faturamento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Notas elegíveis" value={totals.docs} />
            <Stat label="CT-es a gerar" value={groups.length} highlight />
            <Stat label="Valor da carga" value={`R$ ${totals.cargo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
            <Stat label="Frete total" value={`R$ ${totals.freight.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
            <Stat label="Peso (kg)" value={totals.weight.toLocaleString('pt-BR')} />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Modo selecionado: <strong className="text-foreground">{mode.label}</strong>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={groups.length === 0} onClick={() => setPreviewOpen(true)}>
              Ver prévia ({groups.length})
            </Button>
            <Button disabled={groups.length === 0 || createBatch.isPending} onClick={handleGenerate}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {createBatch.isPending ? 'Gerando...' : `Gerar ${groups.length} CT-e(s)`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Histórico de lotes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Lotes gerados
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead className="text-right">CT-es</TableHead>
                <TableHead className="text-right">Frete</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docsLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : batches.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum lote gerado ainda</TableCell></TableRow>
              ) : batches.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">{format(new Date(b.created_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                  <TableCell className="text-sm">{b.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className="font-mono">#{String(b.grouping_mode).padStart(2, '0')}</Badge>{' '}
                    <span className="text-muted-foreground text-xs">{b.grouping_mode_label}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium">{b.total_documents}</TableCell>
                  <TableCell className="text-right">R$ {Number(b.total_freight).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      b.status === 'generated' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                      b.status === 'cancelled' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                      'bg-amber-500/10 text-amber-600 border-amber-500/20'
                    }>
                      {b.status === 'generated' ? 'Gerado' : b.status === 'cancelled' ? 'Cancelado' : 'Rascunho'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {b.status !== 'cancelled' && (
                      <Button variant="ghost" size="sm" onClick={() => cancelBatch.mutate(b.id)}>
                        <XCircle className="h-4 w-4 mr-1" /> Cancelar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Prévia dos CT-es a gerar</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead className="text-right">NFs</TableHead>
                  <TableHead className="text-right">Pallets</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">Frete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g, i) => (
                  <TableRow key={g.key}>
                    <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                    <TableCell className="text-sm">{g.remitter || '—'}</TableCell>
                    <TableCell className="text-sm">{g.recipient || '—'}</TableCell>
                    <TableCell className="text-right">{g.invoice_count}</TableCell>
                    <TableCell className="text-right">{g.pallet_count}</TableCell>
                    <TableCell className="text-right">{g.weight_kg.toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right">R$ {g.freight_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Fechar</Button>
            <Button onClick={handleGenerate} disabled={createBatch.isPending}>
              <RotateCw className={`h-4 w-4 mr-2 ${createBatch.isPending ? 'animate-spin' : ''}`} />
              Confirmar geração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode selection dialog */}
      <Dialog open={modeDialogOpen} onOpenChange={setModeDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Escolha o modo de geração do conhecimento
            </DialogTitle>
          </DialogHeader>
          <TooltipProvider>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto p-1">
              {GROUPING_MODES.map(m => (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => { setModeId(m.id); setModeDialogOpen(false); }}
                      className={`text-left rounded-md border px-3 py-2 transition-colors ${
                        modeId === m.id
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`font-mono text-xs shrink-0 mt-0.5 ${modeId === m.id ? 'text-primary' : 'text-muted-foreground'}`}>
                          {String(m.id).padStart(2, '0')}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.shortLabel}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{m.keys.join(' • ')}</p>
                        </div>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium">{m.label}</p>
                    <p className="text-xs mt-1 opacity-80">{m.description}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModeDialogOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}