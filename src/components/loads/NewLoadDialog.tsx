import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCreateLoad } from '@/hooks/useLoads';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertTriangle, Plus, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  vehicles: any[];
  drivers: any[];
  onCreated: () => void;
}

export default function NewLoadDialog({ vehicles, drivers, onCreated }: Props) {
  const createLoad = useCreateLoad();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: clients = [] } = useClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const emptyForm = { load_number: '', vehicle_id: '', driver_id: '', origin: '', destination: '', neighborhood: '', invoice_number: '', client_id: '', client_name: '', supplier: '', notes: '' };
  const [form, setForm] = useState(emptyForm);
  const [docFilters, setDocFilters] = useState({ invoice: '', client: '', neighborhood: '' });
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);

  const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const { data: fiscalDocs = [] } = useQuery({
    queryKey: ['new_load_available_fiscal_docs', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, remitter, recipient, recipient_neighborhood, recipient_city, recipient_state, pallet_count, weight_kg, product_summary, load_id, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'inbound')
        .is('load_id', null)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && open,
  });

  const filteredDocs = useMemo(() => {
    const invoice = normalize(docFilters.invoice);
    const client = normalize(docFilters.client);
    const neighborhood = normalize(docFilters.neighborhood);
    return fiscalDocs.filter((doc: any) => {
      const docInvoice = normalize(doc.invoice_number || '');
      const docClient = normalize(doc.clients?.company_name || doc.recipient || '');
      const docNeighborhood = normalize(doc.recipient_neighborhood || '');
      if (invoice && !docInvoice.includes(invoice)) return false;
      if (client && !docClient.includes(client)) return false;
      if (neighborhood && !docNeighborhood.includes(neighborhood)) return false;
      return true;
    });
  }, [docFilters, fiscalDocs]);

  const selectedDocs = useMemo(() => fiscalDocs.filter((doc: any) => selectedDocIds.has(doc.id)), [fiscalDocs, selectedDocIds]);

  const previewValidationIssues = useMemo(() => {
    if (!previewDoc) return [];
    const expectedClient = previewDoc.clients?.company_name || previewDoc.recipient || '';
    const expectedDestination = [previewDoc.recipient_neighborhood, previewDoc.recipient_city, previewDoc.recipient_state].filter(Boolean).join(' - ');
    const issues: { key: string; field: string; message: string; severity: 'warning' | 'error' }[] = [];

    if (!previewDoc.invoice_number) issues.push({ key: 'missing-invoice', field: 'invoice', message: 'Número da NF ausente na nota.', severity: 'error' });
    if (!expectedClient) issues.push({ key: 'missing-client', field: 'client', message: 'Cliente/destinatário ausente na nota.', severity: 'error' });
    if (!previewDoc.remitter) issues.push({ key: 'missing-supplier', field: 'supplier', message: 'Fornecedor/remetente ausente na nota.', severity: 'warning' });
    if (!previewDoc.recipient_neighborhood) issues.push({ key: 'missing-neighborhood', field: 'neighborhood', message: 'Bairro ausente na nota.', severity: 'error' });
    if (!previewDoc.recipient_city || !previewDoc.recipient_state) issues.push({ key: 'missing-city-state', field: 'destination', message: 'Cidade ou UF ausente para montar a rota.', severity: 'warning' });

    if (form.invoice_number.trim() && previewDoc.invoice_number && normalize(form.invoice_number) !== normalize(previewDoc.invoice_number)) {
      issues.push({ key: 'inconsistent-invoice', field: 'invoice', message: `NF atual difere da nota (${previewDoc.invoice_number}).`, severity: 'warning' });
    }
    if (form.client_name.trim() && expectedClient && normalize(form.client_name) !== normalize(expectedClient)) {
      issues.push({ key: 'inconsistent-client', field: 'client', message: `Cliente atual difere da nota (${expectedClient}).`, severity: 'warning' });
    }
    if (form.neighborhood.trim() && previewDoc.recipient_neighborhood && normalize(form.neighborhood) !== normalize(previewDoc.recipient_neighborhood)) {
      issues.push({ key: 'inconsistent-neighborhood', field: 'neighborhood', message: `Bairro atual difere da nota (${previewDoc.recipient_neighborhood}).`, severity: 'warning' });
    }
    if (form.destination.trim() && expectedDestination && !normalize(form.destination).includes(normalize(previewDoc.recipient_city || previewDoc.recipient_neighborhood || ''))) {
      issues.push({ key: 'inconsistent-destination', field: 'destination', message: `Rota atual pode divergir do destino da nota (${expectedDestination}).`, severity: 'warning' });
    }

    return issues;
  }, [form.client_name, form.destination, form.invoice_number, form.neighborhood, previewDoc]);

  const previewIssueFields = useMemo(() => new Set(previewValidationIssues.map(issue => issue.field)), [previewValidationIssues]);

  const validationSuggestions = useMemo(() => {
    const primaryDoc: any = selectedDocs[0];
    const knownNeighborhoods = new Set(fiscalDocs.map((doc: any) => normalize(doc.recipient_neighborhood || '')).filter(Boolean));
    const suggestions: { key: string; title: string; description: string; action?: 'neighborhood' | 'destination' | 'client' | 'invoice' }[] = [];

    if (form.neighborhood.trim() && knownNeighborhoods.size > 0 && !knownNeighborhoods.has(normalize(form.neighborhood))) {
      suggestions.push({
        key: 'unknown-neighborhood',
        title: 'Bairro não cadastrado nas notas pendentes',
        description: primaryDoc?.recipient_neighborhood ? `Sugestão: usar "${primaryDoc.recipient_neighborhood}" da nota selecionada.` : 'Confira a digitação ou mantenha como rota personalizada.',
        action: primaryDoc?.recipient_neighborhood ? 'neighborhood' : undefined,
      });
    }

    if (primaryDoc) {
      const expectedDestination = [primaryDoc.recipient_neighborhood, primaryDoc.recipient_city, primaryDoc.recipient_state].filter(Boolean).join(' - ');
      const expectedClient = primaryDoc.clients?.company_name || primaryDoc.recipient || '';

      if (primaryDoc.invoice_number && form.invoice_number.trim() && normalize(form.invoice_number) !== normalize(primaryDoc.invoice_number)) {
        suggestions.push({ key: 'invoice-mismatch', title: 'Número da NF diferente da nota selecionada', description: `Sugestão: voltar para "${primaryDoc.invoice_number}".`, action: 'invoice' });
      }
      if (expectedClient && form.client_name.trim() && normalize(form.client_name) !== normalize(expectedClient)) {
        suggestions.push({ key: 'client-mismatch', title: 'Cliente divergente da nota', description: `Sugestão: usar "${expectedClient}".`, action: 'client' });
      }
      if (!primaryDoc.recipient_neighborhood) {
        suggestions.push({ key: 'missing-doc-neighborhood', title: 'Nota sem bairro cadastrado', description: 'Preencha o bairro manualmente antes de criar a carga.' });
      } else if (form.neighborhood.trim() && normalize(form.neighborhood) !== normalize(primaryDoc.recipient_neighborhood)) {
        suggestions.push({ key: 'neighborhood-mismatch', title: 'Bairro divergente da nota', description: `Sugestão: usar "${primaryDoc.recipient_neighborhood}".`, action: 'neighborhood' });
      }
      if (expectedDestination && form.destination.trim() && !normalize(form.destination).includes(normalize(primaryDoc.recipient_city || primaryDoc.recipient_neighborhood || ''))) {
        suggestions.push({ key: 'destination-mismatch', title: 'Destino/rota divergente', description: `Sugestão: usar "${expectedDestination}" ou revisar a rota personalizada.`, action: 'destination' });
      }
    }

    return suggestions;
  }, [fiscalDocs, form.client_name, form.destination, form.invoice_number, form.neighborhood, selectedDocs]);

  const applySuggestion = (action: 'neighborhood' | 'destination' | 'client' | 'invoice') => {
    const doc: any = selectedDocs[0];
    if (!doc) return;
    setForm(f => ({
      ...f,
      ...(action === 'neighborhood' ? { neighborhood: doc.recipient_neighborhood || '' } : {}),
      ...(action === 'destination' ? { destination: [doc.recipient_neighborhood, doc.recipient_city, doc.recipient_state].filter(Boolean).join(' - ') } : {}),
      ...(action === 'client' ? { client_name: doc.clients?.company_name || doc.recipient || '' } : {}),
      ...(action === 'invoice' ? { invoice_number: doc.invoice_number || '' } : {}),
    }));
  };

  const applyDocSelection = (doc: any) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      next.add(doc.id);
      return next;
    });
    if (!form.invoice_number && !form.client_name && !form.supplier) {
      setForm(f => ({
        ...f,
        invoice_number: doc.invoice_number || '',
        client_name: doc.clients?.company_name || doc.recipient || '',
        supplier: doc.remitter || '',
        neighborhood: doc.recipient_neighborhood || '',
        destination: [doc.recipient_neighborhood, doc.recipient_city, doc.recipient_state].filter(Boolean).join(' - '),
      }));
    }
    setPreviewDoc(null);
  };

  const removeDocSelection = (docId: string) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      next.delete(docId);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      const notes = [
        form.notes,
        form.invoice_number ? `NF: ${form.invoice_number}` : '',
        form.client_name ? `Cliente: ${form.client_name}` : '',
        form.supplier ? `Fornecedor: ${form.supplier}` : '',
        form.neighborhood ? `Bairro: ${form.neighborhood}` : '',
      ].filter(Boolean).join('\n');

      const load = await createLoad.mutateAsync({
        load_number: form.load_number,
        origin: form.origin || null,
        destination: form.destination || form.neighborhood || null,
        notes: notes || null,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        status: 'planned',
      } as any);

      let manualDocId: string | null = null;
      const selectedDocIdList = Array.from(selectedDocIds);

      if (selectedDocIdList.length === 1) {
        const { error: updateDocError } = await supabase.from('fiscal_documents').update({
          invoice_number: form.invoice_number.trim() || null,
          client_id: form.client_id || null,
          recipient: form.client_name || clients.find(c => c.id === form.client_id)?.company_name || null,
          recipient_neighborhood: form.neighborhood || null,
          recipient_city: form.destination || null,
          updated_at: new Date().toISOString(),
        } as any).eq('id', selectedDocIdList[0]);
        if (updateDocError) throw updateDocError;
      }

      if (form.invoice_number.trim() && selectedDocIdList.length === 0) {
        const { data: createdDoc, error: docError } = await supabase.from('fiscal_documents').insert({
          tenant_id: currentTenant!.id,
          created_by: user?.id,
          document_type: 'inbound',
          invoice_number: form.invoice_number.trim(),
          client_id: form.client_id || null,
          recipient: form.client_name || clients.find(c => c.id === form.client_id)?.company_name || null,
          remitter: form.supplier || null,
          recipient_neighborhood: form.neighborhood || null,
          recipient_city: form.destination || null,
          load_id: load.id,
          status: 'confirmed',
        } as any).select('id').single();
        if (docError) throw docError;
        manualDocId = createdDoc.id;
      }

      const docIds = [...selectedDocIdList, ...(manualDocId ? [manualDocId] : [])];
      if (docIds.length > 0) {
        if (selectedDocIdList.length > 0) {
          const { error: linkError } = await supabase.from('fiscal_documents').update({ load_id: load.id } as any).in('id', selectedDocIdList);
          if (linkError) throw linkError;
        }
        const items = docIds.map(id => {
          const doc: any = fiscalDocs.find((d: any) => d.id === id);
          return {
            tenant_id: currentTenant!.id,
            load_id: load.id,
            fiscal_document_id: id,
            item_description: doc?.product_summary || `NF ${doc?.invoice_number || form.invoice_number}`,
            quantity: 1,
            pallet_count: Number(doc?.pallet_count) || 0,
            weight_kg: Number(doc?.weight_kg) || 0,
            status: 'pending',
          };
        });
        const { error: itemError } = await (supabase as any).from('load_items').insert(items);
        if (itemError) throw itemError;
      }

      toast({ title: 'Carga criada' });
      setOpen(false);
      setForm(emptyForm);
      setDocFilters({ invoice: '', client: '', neighborhood: '' });
      setSelectedDocIds(new Set());
      setPreviewDoc(null);
      queryClient.invalidateQueries({ queryKey: ['fiscal_documents'] });
      queryClient.invalidateQueries({ queryKey: ['load_items'] });
      onCreated();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Carga</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nova Carga</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Nº Carga *</Label><Input value={form.load_number} onChange={e => setForm(f => ({ ...f, load_number: e.target.value }))} placeholder="CG-001" /></div>
            <div>
              <Label className="text-xs">Veículo</Label>
              <Select value={form.vehicle_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Motorista</Label>
              <Select value={form.driver_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, driver_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Destino / Rota personalizada</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="Centro, rota local, cliente X" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Número da NF</Label><Input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} placeholder="NF 12345" /></div>
            <div><Label className="text-xs">Bairro</Label><Input value={form.neighborhood} onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))} placeholder="Bairro de entrega" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Razão social do cliente</Label>
              <Input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value, client_id: '' }))} placeholder="Cliente / destinatário" />
            </div>
            <div><Label className="text-xs">Fornecedor</Label><Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Remetente / fornecedor" /></div>
          </div>
          {validationSuggestions.length > 0 && (
            <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-warning">
                <AlertTriangle className="h-4 w-4" /> Inconsistências encontradas
              </div>
              <div className="space-y-2">
                {validationSuggestions.map(suggestion => (
                  <div key={suggestion.key} className="flex items-start justify-between gap-3 rounded-md bg-background/60 p-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{suggestion.title}</div>
                      <div className="text-[11px] text-muted-foreground">{suggestion.description}</div>
                    </div>
                    {suggestion.action && (
                      <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" onClick={() => applySuggestion(suggestion.action!)}>
                        Aplicar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Puxar notas disponíveis</Label>
              <span className="text-[11px] text-muted-foreground">{selectedDocIds.size} selecionada(s)</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={docFilters.invoice} onChange={e => setDocFilters(f => ({ ...f, invoice: e.target.value }))} placeholder="Nº NF" className="pl-9 h-9" />
              </div>
              <Input value={docFilters.client} onChange={e => setDocFilters(f => ({ ...f, client: e.target.value }))} placeholder="Cliente" className="h-9" />
              <Input value={docFilters.neighborhood} onChange={e => setDocFilters(f => ({ ...f, neighborhood: e.target.value }))} placeholder="Bairro" className="h-9" />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {filteredDocs.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">Nenhuma nota pendente encontrada</div>
              ) : filteredDocs.map((doc: any) => {
                const isSelected = selectedDocIds.has(doc.id);
                return (
                <button key={doc.id} type="button" onClick={() => isSelected ? removeDocSelection(doc.id) : setPreviewDoc(doc)} className="w-full flex items-start gap-2 rounded-md border border-border px-2 py-2 text-left hover:bg-muted/60">
                  <Checkbox checked={isSelected} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">NF {doc.invoice_number || '—'} · {doc.clients?.company_name || doc.recipient || 'Sem cliente'}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">{doc.remitter || 'Fornecedor não informado'} · {doc.recipient_neighborhood || 'Sem bairro'}</span>
                  </span>
                </button>
                );
              })}
            </div>
            {previewDoc && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium">Pré-visualização da NF {previewDoc.invoice_number || '—'}</div>
                    <div className="text-[11px] text-muted-foreground">Confira os dados que serão preenchidos automaticamente.</div>
                  </div>
                  <Button size="sm" onClick={() => applyDocSelection(previewDoc)}>Confirmar nota</Button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div><span className="text-muted-foreground">Cliente:</span> {previewDoc.clients?.company_name || previewDoc.recipient || '—'}</div>
                  <div><span className="text-muted-foreground">Fornecedor:</span> {previewDoc.remitter || '—'}</div>
                  <div><span className="text-muted-foreground">Bairro:</span> {previewDoc.recipient_neighborhood || '—'}</div>
                  <div><span className="text-muted-foreground">Cidade/UF:</span> {[previewDoc.recipient_city, previewDoc.recipient_state].filter(Boolean).join(' / ') || '—'}</div>
                  <div><span className="text-muted-foreground">Paletes:</span> {previewDoc.pallet_count ?? 0}</div>
                  <div><span className="text-muted-foreground">Peso:</span> {previewDoc.weight_kg ?? 0} kg</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Produto:</span> {previewDoc.product_summary || '—'}</div>
                </div>
              </div>
            )}
          </div>
          <div><Label className="text-xs">Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.load_number.trim() || createLoad.isPending}>Criar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
