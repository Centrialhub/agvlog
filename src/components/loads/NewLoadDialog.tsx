import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNextLoadNumberFromExisting, useCreateLoadWithNextNumber } from '@/hooks/useLoads';
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
import { AlertTriangle, Eye, Loader2, Plus, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  vehicles: any[];
  drivers: any[];
  onCreated: () => void;
}

const DOC_PAGE_SIZE = 25;
const FILTER_DEBOUNCE_MS = 250;
const NEW_LOAD_DOC_FILTERS_KEY = 'agvlog:new-load-doc-filters';
const NEW_LOAD_DOC_SORT_KEY = 'agvlog:new-load-doc-sort';

const emptyDocFilters = { invoice: '', client: '', neighborhood: '' };

const loadStoredDocFilters = () => {
  try {
    const stored = window.localStorage.getItem(NEW_LOAD_DOC_FILTERS_KEY);
    return stored ? { ...emptyDocFilters, ...JSON.parse(stored) } : emptyDocFilters;
  } catch {
    return emptyDocFilters;
  }
};

const loadStoredDocSort = (): 'recent' | 'alpha' => {
  const stored = window.localStorage.getItem(NEW_LOAD_DOC_SORT_KEY);
  return stored === 'alpha' ? 'alpha' : 'recent';
};

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debouncedValue;
}

export default function NewLoadDialog({ vehicles, drivers, onCreated }: Props) {
  const createLoad = useCreateLoadWithNextNumber();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: clients = [] } = useClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [recentDocsOpen, setRecentDocsOpen] = useState(false);
  const emptyForm = { load_number: '', vehicle_id: '', driver_id: '', origin: '', destination: '', neighborhood: '', invoice_number: '', client_id: '', client_name: '', supplier: '', notes: '' };
  const [form, setForm] = useState(emptyForm);
  const [loadNumberTouched, setLoadNumberTouched] = useState(false);
  const [docFilters, setDocFilters] = useState(loadStoredDocFilters);
  const [docSort, setDocSort] = useState<'recent' | 'alpha'>(loadStoredDocSort);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [detailsDoc, setDetailsDoc] = useState<any | null>(null);
  const [docAutofillSnapshots, setDocAutofillSnapshots] = useState<Record<string, Record<string, string>>>({});
  const [visibleDocCount, setVisibleDocCount] = useState(DOC_PAGE_SIZE);
  const [visibleRecentDocCount, setVisibleRecentDocCount] = useState(DOC_PAGE_SIZE);
  const [docsLayoutKey, setDocsLayoutKey] = useState(0);
  const [modalHeight, setModalHeight] = useState('min(92vh, 860px)');
  const docListRef = useRef<HTMLDivElement | null>(null);
  const recentDocListRef = useRef<HTMLDivElement | null>(null);
  const debouncedDocFilters = useDebouncedValue(docFilters, FILTER_DEBOUNCE_MS);

  const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const { data: fiscalDocs = [], isFetching: isFetchingFiscalDocs } = useQuery({
    queryKey: ['new_load_available_fiscal_docs', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, remitter, recipient, recipient_neighborhood, recipient_city, recipient_state, pallet_count, weight_kg, product_summary, load_id, created_at, clients(company_name), loads(id, load_number)')
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && open,
  });

  const { data: nextLoadNumber = '', isFetching: isFetchingNextLoadNumber } = useQuery({
    queryKey: ['next_load_number_preview', currentTenant?.id, open],
    queryFn: async () => {
      if (!currentTenant) return '';
      return getNextLoadNumberFromExisting(currentTenant.id);
    },
    enabled: !!currentTenant && open,
  });

  const { data: linkedLoads = [] } = useQuery({
    queryKey: ['new_load_linked_load_lookup', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('loads')
        .select('id, load_number')
        .eq('tenant_id', currentTenant.id)
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && open,
  });

  const linkedLoadById = useMemo(() => new Map(linkedLoads.map((load: any) => [load.id, load])), [linkedLoads]);
  const isDocsUpdating = isFetchingFiscalDocs || isFetchingNextLoadNumber || docFilters.invoice !== debouncedDocFilters.invoice || docFilters.client !== debouncedDocFilters.client || docFilters.neighborhood !== debouncedDocFilters.neighborhood;

  const getLinkedLoad = (doc: any) => doc.loads || linkedLoadById.get(doc.load_id) || null;

  useEffect(() => {
    if (!open || loadNumberTouched || !nextLoadNumber) return;
    setForm(f => ({ ...f, load_number: nextLoadNumber }));
  }, [loadNumberTouched, nextLoadNumber, open]);

  useEffect(() => {
    window.localStorage.setItem(NEW_LOAD_DOC_FILTERS_KEY, JSON.stringify(docFilters));
  }, [docFilters]);

  useEffect(() => {
    window.localStorage.setItem(NEW_LOAD_DOC_SORT_KEY, docSort);
  }, [docSort]);

  const filteredDocs = useMemo(() => {
    const invoice = normalize(debouncedDocFilters.invoice);
    const invoiceDigits = debouncedDocFilters.invoice.replace(/\D/g, '');
    const client = normalize(debouncedDocFilters.client);
    const neighborhood = normalize(debouncedDocFilters.neighborhood);
    const docs = fiscalDocs.filter((doc: any) => {
      const docInvoice = normalize(doc.invoice_number || '');
      const docInvoiceDigits = String(doc.invoice_number || '').replace(/\D/g, '');
      const docClient = normalize(doc.clients?.company_name || doc.recipient || '');
      const docNeighborhood = normalize(doc.recipient_neighborhood || '');
      if (invoice && !docInvoice.includes(invoice) && (!invoiceDigits || !docInvoiceDigits.includes(invoiceDigits))) return false;
      if (client && !docClient.includes(client)) return false;
      if (neighborhood && !docNeighborhood.includes(neighborhood)) return false;
      return true;
    });
    return docs.sort((a: any, b: any) => docSort === 'alpha'
      ? String(a.clients?.company_name || a.recipient || a.invoice_number || '').localeCompare(String(b.clients?.company_name || b.recipient || b.invoice_number || ''), 'pt-BR')
      : new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [debouncedDocFilters, docSort, fiscalDocs]);

  const recentDocs = useMemo(() => [...fiscalDocs].sort((a: any, b: any) => docSort === 'alpha'
    ? String(a.clients?.company_name || a.recipient || a.invoice_number || '').localeCompare(String(b.clients?.company_name || b.recipient || b.invoice_number || ''), 'pt-BR')
    : new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()), [docSort, fiscalDocs]);

  const selectableFilteredDocs = useMemo(() => filteredDocs, [filteredDocs]);

  const linkedFilteredDocs = useMemo(() => filteredDocs.filter((doc: any) => doc.load_id), [filteredDocs]);

  const selectedDocs = useMemo(() => fiscalDocs.filter((doc: any) => selectedDocIds.has(doc.id)), [fiscalDocs, selectedDocIds]);
  const selectedDocsPreview = selectedDocs.slice(0, 4);

  const loadPreview = useMemo(() => {
    const totals = selectedDocs.reduce((acc: any, doc: any) => ({
      pallets: acc.pallets + (Number(doc.pallet_count) || 0),
      weight: acc.weight + (Number(doc.weight_kg) || 0),
    }), { pallets: 0, weight: 0 });

    return {
      number: form.load_number || nextLoadNumber || '—',
      destination: form.destination || form.neighborhood || 'Sem destino definido',
      docsCount: selectedDocs.length,
      pallets: totals.pallets,
      weight: totals.weight,
    };
  }, [form.destination, form.load_number, form.neighborhood, nextLoadNumber, selectedDocs]);

  const visibleFilteredDocs = useMemo(() => filteredDocs.slice(0, visibleDocCount), [filteredDocs, visibleDocCount]);
  const visibleRecentDocs = useMemo(() => recentDocs.slice(0, visibleRecentDocCount), [recentDocs, visibleRecentDocCount]);

  useEffect(() => {
    setVisibleDocCount(DOC_PAGE_SIZE);
  }, [debouncedDocFilters.invoice, debouncedDocFilters.client, debouncedDocFilters.neighborhood, open]);

  useEffect(() => {
    if (recentDocsOpen) setVisibleRecentDocCount(DOC_PAGE_SIZE);
  }, [recentDocsOpen]);

  const recalculateModalHeight = () => {
    const viewportHeight = window.innerHeight || 720;
    const availableHeight = Math.max(360, viewportHeight - 24);
    setModalHeight(`${Math.min(availableHeight, 860)}px`);
  };

  useEffect(() => {
    if (!open) return;
    recalculateModalHeight();
    window.addEventListener('resize', recalculateModalHeight);
    return () => window.removeEventListener('resize', recalculateModalHeight);
  }, [open]);

  const handleListScroll = (event: any, total: number, visible: number, setVisible: (updater: (count: number) => number) => void) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visible < total) {
      setVisible(count => Math.min(count + DOC_PAGE_SIZE, total));
    }
  };

  const reorganizeDocsLayout = () => {
    recalculateModalHeight();
    setVisibleDocCount(DOC_PAGE_SIZE);
    setVisibleRecentDocCount(DOC_PAGE_SIZE);
    setDocsLayoutKey(key => key + 1);
    window.requestAnimationFrame(() => {
      docListRef.current?.scrollTo({ top: 0 });
      recentDocListRef.current?.scrollTo({ top: 0 });
    });
  };

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

  const getDocAutofillFields = (doc: any) => ({
    invoice_number: doc.invoice_number || '',
    client_name: doc.clients?.company_name || doc.recipient || '',
    supplier: doc.remitter || '',
    neighborhood: doc.recipient_neighborhood || '',
    destination: [doc.recipient_neighborhood, doc.recipient_city, doc.recipient_state].filter(Boolean).join(' - '),
  });

  const buildAggregatedFields = (docs: any[]) => {
    const unique = (values: string[]) => Array.from(new Set(values.map(v => v.trim()).filter(Boolean)));
    const invoices = unique(docs.map(doc => doc.invoice_number || ''));
    const clientsList = unique(docs.map(doc => doc.clients?.company_name || doc.recipient || ''));
    const suppliers = unique(docs.map(doc => doc.remitter || ''));
    const neighborhoods = unique(docs.map(doc => doc.recipient_neighborhood || ''));
    const destinations = unique(docs.map(doc => [doc.recipient_neighborhood, doc.recipient_city, doc.recipient_state].filter(Boolean).join(' - ')));

    return {
      invoice_number: invoices.join(', '),
      client_name: clientsList.length <= 1 ? clientsList[0] || '' : `Múltiplos clientes (${clientsList.length})`,
      supplier: suppliers.length <= 1 ? suppliers[0] || '' : `Múltiplos fornecedores (${suppliers.length})`,
      neighborhood: neighborhoods.length <= 1 ? neighborhoods[0] || '' : neighborhoods.join(', '),
      destination: destinations.length <= 1 ? destinations[0] || '' : destinations.join(' | '),
    };
  };

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
    const autoFilledFields = getDocAutofillFields(doc);
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      next.add(doc.id);
      const docs = fiscalDocs.filter((item: any) => next.has(item.id));
      setForm(f => ({ ...f, ...buildAggregatedFields(docs) }));
      return next;
    });
    setDocAutofillSnapshots(prev => ({ ...prev, [doc.id]: autoFilledFields }));
    setPreviewDoc(null);
    setRecentDocsOpen(false);
  };

  const removeDocSelection = (docId: string) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      next.delete(docId);
      const docs = fiscalDocs.filter((item: any) => next.has(item.id));
      setForm(f => ({ ...f, ...buildAggregatedFields(docs) }));
      return next;
    });
    setDocAutofillSnapshots(prev => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  const selectFilteredDocs = () => {
    const nextIds = new Set([...Array.from(selectedDocIds), ...selectableFilteredDocs.map((doc: any) => doc.id)]);
    const nextSnapshots = selectableFilteredDocs.reduce((acc, doc: any) => ({ ...acc, [doc.id]: getDocAutofillFields(doc) }), docAutofillSnapshots);
    setSelectedDocIds(nextIds);
    setDocAutofillSnapshots(nextSnapshots);
    setForm(f => ({ ...f, ...buildAggregatedFields(fiscalDocs.filter((doc: any) => nextIds.has(doc.id))) }));
    setPreviewDoc(null);
  };

  const clearDocSelection = () => {
    setSelectedDocIds(new Set());
    setDocAutofillSnapshots({});
    setForm(f => ({ ...f, invoice_number: '', client_name: '', supplier: '', neighborhood: '', destination: '' }));
    setPreviewDoc(null);
  };

  const refreshLoadTotals = async (loadIds: string[]) => {
    const uniqueLoadIds = Array.from(new Set(loadIds.filter(Boolean)));
    await Promise.all(uniqueLoadIds.map(async loadId => {
      const { data, error } = await (supabase as any).from('load_items').select('pallet_count, weight_kg, volume_m3').eq('load_id', loadId);
      if (error) throw error;
      const totals = (data || []).reduce((acc: any, item: any) => ({
        pallet_count: acc.pallet_count + (Number(item.pallet_count) || 0),
        weight_kg: acc.weight_kg + (Number(item.weight_kg) || 0),
        volume_m3: acc.volume_m3 + (Number(item.volume_m3) || 0),
      }), { pallet_count: 0, weight_kg: 0, volume_m3: 0 });
      const { error: updateError } = await supabase.from('loads').update({
        total_pallet_count: totals.pallet_count,
        total_weight_kg: totals.weight_kg,
        total_volume_m3: totals.volume_m3,
        updated_at: new Date().toISOString(),
      } as any).eq('id', loadId);
      if (updateError) throw updateError;
    }));
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
        load_number: form.load_number.trim() || nextLoadNumber,
        origin: form.origin || null,
        destination: form.destination || form.neighborhood || null,
        notes: notes || null,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        status: 'planned',
      } as any);

      let manualDocId: string | null = null;
      const selectedDocIdList = Array.from(selectedDocIds);
      const previousLoadIds = Array.from(new Set(selectedDocIdList.map(docId => fiscalDocs.find((d: any) => d.id === docId)?.load_id).filter(Boolean)));

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
          const { error: unlinkItemsError } = await (supabase as any)
            .from('load_items')
            .delete()
            .eq('tenant_id', currentTenant!.id)
            .in('fiscal_document_id', selectedDocIdList);
          if (unlinkItemsError) throw unlinkItemsError;

          const { error: linkError } = await supabase.from('fiscal_documents').update({ load_id: load.id } as any).in('id', selectedDocIdList);
          if (linkError) throw linkError;
          const auditEvents = selectedDocIdList.map(docId => {
            const doc: any = fiscalDocs.find((d: any) => d.id === docId);
            const autoFilledFields = docAutofillSnapshots[docId] || {};
            return {
              tenant_id: currentTenant!.id,
              load_id: load.id,
              fiscal_document_id: docId,
              previous_load_id: doc?.load_id || null,
              created_by: user?.id,
              action_type: 'selected_for_load',
              invoice_number: doc?.invoice_number || form.invoice_number || null,
              client_name: autoFilledFields.client_name || form.client_name || null,
              supplier_name: autoFilledFields.supplier || form.supplier || null,
              neighborhood: autoFilledFields.neighborhood || form.neighborhood || null,
              route_destination: autoFilledFields.destination || form.destination || null,
              details: {
                source: 'new_load_dialog',
                selected_document: {
                  id: docId,
                  invoice_number: doc?.invoice_number || null,
                  recipient: doc?.recipient || null,
                  remitter: doc?.remitter || null,
                  neighborhood: doc?.recipient_neighborhood || null,
                  city: doc?.recipient_city || null,
                  state: doc?.recipient_state || null,
                },
                auto_filled_fields: autoFilledFields,
                final_fields: {
                  invoice_number: form.invoice_number || null,
                  client_name: form.client_name || null,
                  supplier: form.supplier || null,
                  neighborhood: form.neighborhood || null,
                  destination: form.destination || null,
                },
              },
            };
          });
          const { error: auditError } = await (supabase as any).from('load_note_audit_events').insert(auditEvents);
          if (auditError) throw auditError;
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
        await refreshLoadTotals([...previousLoadIds, load.id]);
      }

      toast({ title: 'Carga criada' });
      setOpen(false);
      setForm(emptyForm);
      setLoadNumberTouched(false);
      setSelectedDocIds(new Set());
      setDocAutofillSnapshots({});
      setPreviewDoc(null);
      setDetailsDoc(null);
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
      <DialogContent className="flex max-w-5xl flex-col overflow-hidden p-0" style={{ height: modalHeight }}>
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle>Nova Carga</DialogTitle></DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Nº Carga *</Label><Input value={form.load_number} onChange={e => { setLoadNumberTouched(true); setForm(f => ({ ...f, load_number: e.target.value })); }} placeholder={nextLoadNumber || 'Sequência automática'} /></div>
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
          {selectedDocIds.size > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
              Nota vinculada: ao criar, notas já roteirizadas sairão da carga antiga e entrarão nesta nova carga.
            </div>
          )}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Prévia da carga {loadPreview.number}</div>
                <div className="text-[11px] text-muted-foreground">{loadPreview.destination}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md border border-border bg-background px-2 py-1"><div className="font-semibold">{loadPreview.docsCount}</div><div className="text-[10px] text-muted-foreground">NFs</div></div>
                <div className="rounded-md border border-border bg-background px-2 py-1"><div className="font-semibold">{loadPreview.pallets}</div><div className="text-[10px] text-muted-foreground">Paletes</div></div>
                <div className="rounded-md border border-border bg-background px-2 py-1"><div className="font-semibold">{loadPreview.weight.toLocaleString('pt-BR')}</div><div className="text-[10px] text-muted-foreground">Kg</div></div>
              </div>
            </div>
            {selectedDocs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Nenhuma NF selecionada ainda.</div>
            ) : (
              <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                {selectedDocs.map((doc: any) => {
                  const linkedLoad = getLinkedLoad(doc);
                  return (
                    <div key={doc.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                      <span className="min-w-0 truncate">NF {doc.invoice_number || '—'} · {doc.clients?.company_name || doc.recipient || 'Sem cliente'}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{Number(doc.pallet_count) || 0} pal · {Number(doc.weight_kg) || 0} kg{doc.load_id ? ` · sai da ${linkedLoad?.load_number || 'atual'}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
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
              <Label className="text-xs">Puxar notas</Label>
              <div className="flex items-center gap-2">
                {isDocsUpdating && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Atualizando...
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">{selectedDocIds.size} selecionada(s)</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={reorganizeDocsLayout}>
                  Reorganizar layout
                </Button>
                {selectableFilteredDocs.length > 0 && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={selectFilteredDocs}>
                    Selecionar filtradas
                  </Button>
                )}
                {selectedDocIds.size > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearDocSelection}>
                    Limpar
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="relative">
                <button type="button" onClick={() => setRecentDocsOpen(true)} className="absolute left-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="Abrir notas recentes">
                  <Search className="h-4 w-4" />
                </button>
                <Input value={docFilters.invoice} onChange={e => setDocFilters(f => ({ ...f, invoice: e.target.value }))} placeholder="Nº NF" className="pl-9 h-9" />
              </div>
              <Input value={docFilters.client} onChange={e => setDocFilters(f => ({ ...f, client: e.target.value }))} placeholder="Cliente" className="h-9" />
              <Input value={docFilters.neighborhood} onChange={e => setDocFilters(f => ({ ...f, neighborhood: e.target.value }))} placeholder="Bairro" className="h-9" />
            </div>
            <div className="flex justify-end">
              <Select value={docSort} onValueChange={(value: 'recent' | 'alpha') => setDocSort(value)}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Mais recentes</SelectItem>
                  <SelectItem value="alpha">Ordem alfabética</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedDocs.length > 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <div className="font-medium text-primary">Seleções mantidas: {selectedDocs.length} NF(s) · {loadPreview.pallets} pal · {loadPreview.weight.toLocaleString('pt-BR')} kg</div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {selectedDocsPreview.map((doc: any) => `NF ${doc.invoice_number || '—'}`).join(' · ')}{selectedDocs.length > selectedDocsPreview.length ? ` · +${selectedDocs.length - selectedDocsPreview.length}` : ''}
                </div>
              </div>
            )}
            <div key={docsLayoutKey} ref={docListRef} className="max-h-[28vh] space-y-1 overflow-y-auto pr-1" onScroll={event => handleListScroll(event, filteredDocs.length, visibleFilteredDocs.length, setVisibleDocCount)}>
              {filteredDocs.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">Nenhuma nota encontrada para esses filtros</div>
              ) : selectableFilteredDocs.length === 0 && linkedFilteredDocs.length > 0 ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
                  <div className="mb-1 flex items-center justify-center gap-2 font-medium text-warning">
                    <AlertTriangle className="h-4 w-4" /> NF já vinculada a outra carga
                  </div>
                  <div className="text-center text-muted-foreground">
                    A nota foi encontrada e pode ser reatribuída para a nova carga. Ela sairá da carga antiga ao criar.
                  </div>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {linkedFilteredDocs.map((doc: any) => {
                      const linkedLoad = getLinkedLoad(doc);
                      return (
                        <Button key={doc.id} asChild type="button" variant="outline" size="sm" className="h-7 text-[11px]">
                          <Link to={`/loads/${linkedLoad?.id || doc.load_id}`}>Abrir carga {linkedLoad?.load_number || 'vinculada'}</Link>
                        </Button>
                      );
                    })}
                  </div>
                </div>
                ) : visibleFilteredDocs.map((doc: any) => {
                const isSelected = selectedDocIds.has(doc.id);
                const isLinked = !!doc.load_id;
                const linkedLoad = getLinkedLoad(doc);
                const actionLabel = isSelected ? 'Selecionada para esta carga' : isLinked ? 'Será reatribuída' : 'Será puxada';
                return (
                <div key={doc.id} className="flex items-start gap-2 rounded-md border border-border px-2 py-2 hover:bg-muted/60">
                  <button
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        removeDocSelection(doc.id);
                        if (previewDoc?.id === doc.id) setPreviewDoc(null);
                        return;
                      }
                      applyDocSelection(doc);
                      setPreviewDoc(doc);
                    }}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <Checkbox checked={isSelected} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">NF {doc.invoice_number || '—'} · {doc.clients?.company_name || doc.recipient || 'Sem cliente'}</span>
                       <span className="block truncate text-[11px] text-muted-foreground">{doc.remitter || 'Fornecedor não informado'} · {doc.recipient_neighborhood || 'Sem bairro'}{isLinked ? ` · sai da carga ${linkedLoad?.load_number || 'atual'}` : ''}</span>
                    </span>
                  </button>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${isSelected ? 'border-primary/30 bg-primary/10 text-primary' : isLinked ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border bg-muted text-muted-foreground'}`}>
                    {actionLabel}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-[11px]" onClick={() => setDetailsDoc(doc)}>
                    <Eye className="h-3.5 w-3.5" /> Ver nota
                  </Button>
                </div>
                );
              })}
              {filteredDocs.length > visibleFilteredDocs.length && (
                <div className="py-2 text-center text-[11px] text-muted-foreground">
                  Role para carregar mais {filteredDocs.length - visibleFilteredDocs.length} NF(s)
                </div>
              )}
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
                {previewValidationIssues.length > 0 && (
                  <div className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2">
                    {previewValidationIssues.map(issue => (
                      <div key={issue.key} className="flex items-start gap-2 text-[11px]">
                        <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 ${issue.severity === 'error' ? 'text-destructive' : 'text-warning'}`} />
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className={previewIssueFields.has('client') ? 'rounded border border-warning/30 bg-warning/10 px-2 py-1' : ''}><span className="text-muted-foreground">Cliente:</span> {previewDoc.clients?.company_name || previewDoc.recipient || '—'}</div>
                  <div className={previewIssueFields.has('supplier') ? 'rounded border border-warning/30 bg-warning/10 px-2 py-1' : ''}><span className="text-muted-foreground">Fornecedor:</span> {previewDoc.remitter || '—'}</div>
                  <div className={previewIssueFields.has('neighborhood') ? 'rounded border border-warning/30 bg-warning/10 px-2 py-1' : ''}><span className="text-muted-foreground">Bairro:</span> {previewDoc.recipient_neighborhood || '—'}</div>
                  <div className={previewIssueFields.has('destination') ? 'rounded border border-warning/30 bg-warning/10 px-2 py-1' : ''}><span className="text-muted-foreground">Cidade/UF:</span> {[previewDoc.recipient_city, previewDoc.recipient_state].filter(Boolean).join(' / ') || '—'}</div>
                  <div><span className="text-muted-foreground">Paletes:</span> {previewDoc.pallet_count ?? 0}</div>
                  <div><span className="text-muted-foreground">Peso:</span> {previewDoc.weight_kg ?? 0} kg</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Produto:</span> {previewDoc.product_summary || '—'}</div>
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          </div>
          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => { setOpen(false); setLoadNumberTouched(false); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.load_number.trim() || createLoad.isPending}>Criar</Button>
          </div>
          <Dialog open={recentDocsOpen} onOpenChange={setRecentDocsOpen}>
            <DialogContent className="flex h-[min(88vh,760px)] max-w-4xl flex-col overflow-hidden p-0">
              <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle>Notas enviadas recentes</DialogTitle></DialogHeader>
              <div key={`recent-${docsLayoutKey}`} ref={recentDocListRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4" onScroll={event => handleListScroll(event, recentDocs.length, visibleRecentDocs.length, setVisibleRecentDocCount)}>
                {recentDocs.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">Nenhuma nota recente disponível</div>
                ) : visibleRecentDocs.map((doc: any) => {
                  const isSelected = selectedDocIds.has(doc.id);
                  const isLinked = !!doc.load_id;
                  const linkedLoad = getLinkedLoad(doc);
                  const actionLabel = isSelected ? 'Selecionada para esta carga' : isLinked ? 'Será reatribuída' : 'Será puxada';
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          removeDocSelection(doc.id);
                          if (previewDoc?.id === doc.id) setPreviewDoc(null);
                          return;
                        }
                        applyDocSelection(doc);
                        setPreviewDoc(doc);
                      }}
                      className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-muted/60"
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox checked={isSelected} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">NF {doc.invoice_number || '—'} · {doc.clients?.company_name || doc.recipient || 'Sem cliente'}</div>
                          <div className="text-xs text-muted-foreground truncate">{doc.remitter || 'Fornecedor não informado'} · {doc.recipient_neighborhood || 'Sem bairro'} · {[doc.recipient_city, doc.recipient_state].filter(Boolean).join(' / ') || 'Sem cidade'}{isLinked ? ` · sai da carga ${linkedLoad?.load_number || 'atual'}` : ''}</div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${isSelected ? 'border-primary/30 bg-primary/10 text-primary' : isLinked ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border bg-muted text-muted-foreground'}`}>
                          {actionLabel}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {recentDocs.length > visibleRecentDocs.length && (
                  <div className="py-2 text-center text-[11px] text-muted-foreground">
                    Role para carregar mais {recentDocs.length - visibleRecentDocs.length} NF(s)
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={!!detailsDoc} onOpenChange={(isOpen) => !isOpen && setDetailsDoc(null)}>
            <DialogContent className="max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto">
              <DialogHeader><DialogTitle>Detalhes da NF {detailsDoc?.invoice_number || '—'}</DialogTitle></DialogHeader>
              {detailsDoc && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Carga vinculada:</span><div className="font-medium">{getLinkedLoad(detailsDoc)?.load_number || 'Não vinculada'}</div></div>
                  <div><span className="text-muted-foreground">Status:</span><div className="font-medium">{detailsDoc.status || '—'}</div></div>
                  <div><span className="text-muted-foreground">Cliente:</span><div className="font-medium">{detailsDoc.clients?.company_name || detailsDoc.recipient || '—'}</div></div>
                  <div><span className="text-muted-foreground">Fornecedor:</span><div className="font-medium">{detailsDoc.remitter || '—'}</div></div>
                  <div><span className="text-muted-foreground">Bairro:</span><div className="font-medium">{detailsDoc.recipient_neighborhood || '—'}</div></div>
                  <div><span className="text-muted-foreground">Cidade/UF:</span><div className="font-medium">{[detailsDoc.recipient_city, detailsDoc.recipient_state].filter(Boolean).join(' / ') || '—'}</div></div>
                  <div><span className="text-muted-foreground">Paletes:</span><div className="font-medium">{detailsDoc.pallet_count ?? 0}</div></div>
                  <div><span className="text-muted-foreground">Peso:</span><div className="font-medium">{detailsDoc.weight_kg ?? 0} kg</div></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Produto:</span><div className="font-medium">{detailsDoc.product_summary || '—'}</div></div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </DialogContent>
    </Dialog>
  );
}
