import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Search, Loader2, UserSearch } from 'lucide-react';
import { useCreateNFSe, useUpdateNFSe, type NFSeDoc } from '@/hooks/useNFSe';
import { useFiscalDocuments } from '@/hooks/useFiscalDocuments';
import { useEmitters } from '@/hooks/useEmitters';
import { normalizeCep, normalizeUf, normalizeIbgeCity, normalizeCityName, normalizePhone, onlyDigits } from '@/lib/fiscal/fiscalAddress';
import { sanitizeIe } from '@/lib/fiscal/partyRegistry';
import { useClients } from '@/hooks/useClients';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { localDateInputValue } from '@/lib/utils/formatDate';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { FiscalEnvironmentSelect } from '@/components/fiscal/FiscalEnvironmentSelect';
import type { HubEnvironment } from '../../../supabase/functions/_shared/fiscal-environment';
import { resolveNFSeTomador } from '@/lib/fiscal/nfseTomador';
import type { TomadorData } from '@/lib/fiscal/nfseTomador';
import { consultOfficialTaxRegistry } from '@/lib/fiscal/taxRegistryClient';
import {
  findActiveNFSeTaxProfile,
  mergeOfficialProfileIntoNFSeTomador,
  missingNFSeTomadorFields,
  needsNFSeTomadorRegistryEnrichment,
} from '@/lib/fiscal/nfseAddressAutocomplete';

interface NFSeItem {
  description: string;
  quantity: number;
  unit_value: number;
  fiscal_document_id?: string;
  access_key?: string | null;
  total: number;
}

interface NFSeFormState {
  cliente_id: string | null;
  branch_code: string;
  emitter_id: string | null;
  regime_tributario: string;
  series: string;
  doc_type: string;
  situacao_doc: string;
  is_preview: boolean;
  issue_date: string;
  cond_pagamento: string;
  tipo_ctrc: string;
  reference_number: string;
  pedido: string;
  cnae: string;
  cod_servico: string;
  nat_operacao: string;
  cod_trib_municipal: string;
  cod_municipio_prestacao: string;
  cliente_nome: string;
  cliente_cnpj: string;
  cliente_ie: string;
  cliente_endereco: string;
  cliente_bairro: string;
  cliente_municipio: string;
  cliente_uf: string;
  cliente_numero: string;
  cliente_complemento: string;
  cliente_cep: string;
  cliente_cod_municipio: string;
  cliente_im: string;
  cliente_email: string;
  cliente_telefone: string;
  pagador_nome: string;
  pagador_cnpj: string;
  description: string;
  aliquota_iss: number;
  iss_retido: boolean;
  valor_servicos: number;
  valor_deducoes: number;
  valor_pis: number;
  valor_cofins: number;
  valor_inss: number;
  valor_ir: number;
  valor_csll: number;
  outras_retencoes: number;
  notes: string;
  load_id: string | null;
  related_cte_ids: string[];
}

interface Props {
  environment: HubEnvironment;
  onEnvironmentChange: (environment: HubEnvironment) => void;
  issuing?: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<NFSeDoc> | null;
  loadId?: string | null;
  onSaved?: (doc: NFSeDoc) => void;
}

function num(value: unknown) { return Number(value ?? 0) || 0; }

function tomadorFromForm(form: NFSeFormState): TomadorData {
  return {
    nome: form.cliente_nome,
    cnpj: form.cliente_cnpj,
    ie: form.cliente_ie,
    im: form.cliente_im,
    endereco: form.cliente_endereco,
    numero: form.cliente_numero,
    complemento: form.cliente_complemento,
    bairro: form.cliente_bairro,
    email: form.cliente_email,
    telefone: form.cliente_telefone,
    municipio: form.cliente_municipio,
    municipio_cod: form.cliente_cod_municipio,
    uf: form.cliente_uf,
    cep: form.cliente_cep,
    cliente_id: form.cliente_id,
  };
}

function applyTomadorToForm(form: NFSeFormState, tomador: TomadorData): NFSeFormState {
  return {
    ...form,
    cliente_id: tomador.cliente_id,
    cliente_nome: tomador.nome,
    cliente_cnpj: tomador.cnpj,
    cliente_ie: tomador.ie,
    cliente_im: tomador.im,
    cliente_endereco: tomador.endereco,
    cliente_numero: tomador.numero,
    cliente_complemento: tomador.complemento,
    cliente_bairro: tomador.bairro,
    cliente_email: tomador.email,
    cliente_telefone: tomador.telefone,
    cliente_municipio: tomador.municipio,
    cliente_cod_municipio: tomador.municipio_cod,
    cliente_uf: tomador.uf,
    cliente_cep: tomador.cep,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Falha ao salvar';
}

const EMPTY_FORM: NFSeFormState = {
  cliente_id: null,
  branch_code: 'MATRIZ', emitter_id: null, regime_tributario: '3', series: '1',
  doc_type: 'NFS', situacao_doc: '00', is_preview: false,
  issue_date: localDateInputValue(), cond_pagamento: '', tipo_ctrc: '',
  reference_number: '', pedido: '', cnae: '', cod_servico: '', nat_operacao: '',
  cod_trib_municipal: '', cod_municipio_prestacao: '', cliente_nome: '', cliente_cnpj: '',
  cliente_ie: '', cliente_endereco: '', cliente_bairro: '', cliente_municipio: '',
  cliente_uf: '', cliente_numero: '', cliente_complemento: '', cliente_cep: '',
  cliente_cod_municipio: '', cliente_im: '', cliente_email: '', cliente_telefone: '',
  pagador_nome: '', pagador_cnpj: '', description: '', aliquota_iss: 5, iss_retido: false,
  valor_servicos: 0, valor_deducoes: 0, valor_pis: 0, valor_cofins: 0, valor_inss: 0,
  valor_ir: 0, valor_csll: 0, outras_retencoes: 0, notes: '', load_id: null,
  related_cte_ids: [],
};

export default function NFSeFormDialog({ open, onOpenChange, environment, onEnvironmentChange, issuing, initial, loadId, onSaved }: Props) {
  const toast = useSonnerToast();
  const create = useCreateNFSe();
  const update = useUpdateNFSe();
  const editing = !!initial?.id;
  const { data: emitters = [] } = useEmitters();
  const { data: clients = [], isPending: clientsLoading, isError: clientsError, refetch: refetchClients } = useClients();

  const [form, setForm] = useState<NFSeFormState>(EMPTY_FORM);
  const [items, setItems] = useState<NFSeItem[]>([]);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({ invoice: '', recipient: '' });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [registryStatus, setRegistryStatus] = useState<'idle' | 'loading' | 'filled' | 'error'>('idle');
  const [registryMessage, setRegistryMessage] = useState('');
  const registryAttemptRef = useRef('');
  const registryRequestRef = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedFilters(filters), 300);
    return () => clearTimeout(timeout);
  }, [filters]);

  const loadDocumentsQuery = useQuery({
    queryKey: ['nfse_load_docs', loadId, environment],
    queryFn: async () => {
      if (!loadId) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('*')
        .eq('load_id', loadId)
        .eq('document_type', 'inbound')
        .is('deleted_at', null)
        .is('cte_emitted_at', null)
        .is('nfse_emitted_document_id', null);
      if (error) throw error;
      const documents = data || [];
      if (documents.length === 0) return documents;
      const { data: reservations, error: reservationError } = await supabase
        .from('fiscal_source_reservations')
        .select('source_id')
        .eq('environment', environment)
        .in('source_id', documents.map(document => document.id));
      if (reservationError) throw reservationError;
      const reservedIds = new Set((reservations || []).map(reservation => reservation.source_id));
      return documents.filter(document => !reservedIds.has(document.id));
    },
    enabled: !!loadId && open,
  });
  const loadDocuments = useMemo(() => loadDocumentsQuery.data ?? [], [loadDocumentsQuery.data]);

  const normalize = (v: string) => v.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const filteredDocs = useMemo(() => {
    return loadDocuments.filter(d => {
      const docInvoice = normalize(d.invoice_number || '');
      const docRecipient = normalize(d.recipient || '');
      const fInvoice = normalize(debouncedFilters.invoice);
      const fRecipient = normalize(debouncedFilters.recipient);
      if (fInvoice && !docInvoice.includes(fInvoice)) return false;
      if (fRecipient && !docRecipient.includes(fRecipient)) return false;
      return true;
    });
  }, [loadDocuments, debouncedFilters]);

  const applyDocumentSelection = (nextIds: Set<string>) => {
    const selected = loadDocuments.filter(document => nextIds.has(document.id));
    if (selected.length !== nextIds.size) {
      toast.error('Uma das NF-es selecionadas não está mais disponível. Atualize a lista.');
      return;
    }
    const tomadores = selected.map(document => resolveNFSeTomador(
      document as Parameters<typeof resolveNFSeTomador>[0], 'destinatario', clients,
    ));
    const identities = new Set(tomadores.map(tomador => tomador.cliente_id || onlyDigits(tomador.cnpj) || normalize(tomador.nome)).filter(Boolean));
    if (identities.size > 1) {
      toast.error('Selecione somente NF-es do mesmo tomador.');
      return;
    }

    const manualItems = items.filter(item => !item.fiscal_document_id);
    const existingByDocument = new Map(items.filter(item => item.fiscal_document_id).map(item => [item.fiscal_document_id!, item]));
    const linkedItems = selected.map(document => existingByDocument.get(document.id) ?? {
      description: `Serviço de transporte ref. NF ${document.invoice_number || ''}`,
      quantity: 1,
      unit_value: num(document.freight_value || document.value || 0),
      total: num(document.freight_value || document.value || 0),
      fiscal_document_id: document.id,
      access_key: document.access_key,
    });
    const nextItems = [...manualItems, ...linkedItems];
    setSelectedIds(new Set(nextIds));
    setItems(nextItems);
    const total = nextItems.reduce((sum, item) => sum + num(item.total), 0);
    if (selected.length === 0) {
      setForm(current => ({
        ...current,
        valor_servicos: total,
        description: current.description.startsWith('Prestação de serviço de transporte ref. NFs:') ? '' : current.description,
      }));
      return;
    }
    const first = selected[0];
    const tomador = tomadores[0];
    const automaticDescription = `Prestação de serviço de transporte ref. NFs: ${selected.map(document => document.invoice_number).join(', ')}`;
    setForm(current => ({
      ...current,
      valor_servicos: total,
      description: !current.description || current.description.startsWith('Prestação de serviço de transporte ref. NFs:')
        ? automaticDescription : current.description,
      cliente_id: tomador.cliente_id || first.client_id || null,
      cliente_nome: tomador.nome,
      cliente_cnpj: tomador.cnpj,
      cliente_ie: tomador.ie,
      cliente_im: tomador.im,
      cliente_municipio: tomador.municipio,
      cliente_uf: tomador.uf,
      cliente_bairro: tomador.bairro,
      cliente_endereco: tomador.endereco,
      cliente_numero: tomador.numero,
      cliente_complemento: tomador.complemento,
      cliente_cep: tomador.cep,
      cliente_cod_municipio: tomador.municipio_cod,
      cliente_email: tomador.email,
      cliente_telefone: tomador.telefone,
    }));
  };

  const selectAll = () => applyDocumentSelection(
    selectedIds.size === filteredDocs.length && filteredDocs.length > 0
      ? new Set<string>() : new Set(filteredDocs.map(document => document.id)),
  );

  const { data: allDocs = [] } = useFiscalDocuments();

  const clientOptions = useMemo(() => {
    return clients
      .filter(c => c.is_client !== false || c.is_supplier !== false)
      .map(c => ({
        value: c.id,
        label: `${c.company_name} (${c.tax_id || 'S/CNPJ'}) ${c.is_supplier && !c.is_client ? '[Fornecedor]' : ''}`,
        raw: c
      }));
  }, [clients]);

  const filteredClientOptions = useMemo(() => {
    const search = clientSearchTerm.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!search) return clientOptions;
    const documentSearch = /^[\d\s./-]+$/.test(search) ? onlyDigits(search) : '';
    return clientOptions.filter((opt) => {
      const text = opt.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return text.includes(search) || (documentSearch !== '' && onlyDigits(opt.raw.tax_id).includes(documentSearch));
    });
  }, [clientOptions, clientSearchTerm]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(initial?.fiscal_document_ids ?? []));
    setClientSearchOpen(false);
    setClientSearchTerm('');
    setRegistryStatus('idle');
    setRegistryMessage('');
    registryAttemptRef.current = '';
    setForm({
      branch_code: initial?.branch_code || 'MATRIZ',
      emitter_id: initial?.emitter_id ?? null,
      regime_tributario: initial?.regime_tributario || '3',
      series: initial?.series || '1',
      doc_type: initial?.doc_type || 'NFS',
      situacao_doc: initial?.situacao_doc || '00',
      is_preview: initial?.is_preview ?? false,
      issue_date: initial?.issue_date || localDateInputValue(),
      cliente_id: initial?.cliente_id || null,
      cond_pagamento: initial?.cond_pagamento || '',
      tipo_ctrc: initial?.tipo_ctrc || '',
      reference_number: initial?.reference_number || '',
      pedido: initial?.pedido || '',
      cnae: initial?.cnae || '',
      cod_servico: initial?.cod_servico || '',
      nat_operacao: initial?.nat_operacao || '',
      cod_trib_municipal: initial?.cod_trib_municipal || '',
      cod_municipio_prestacao: initial?.cod_municipio_prestacao || '',
      cliente_nome: initial?.cliente_nome || '',
      cliente_cnpj: initial?.cliente_cnpj || '',
      cliente_ie: initial?.cliente_ie || '',
      cliente_endereco: initial?.cliente_endereco || '',
      cliente_bairro: initial?.cliente_bairro || '',
      cliente_municipio: initial?.cliente_municipio || '',
      cliente_uf: initial?.cliente_uf || '',
      cliente_numero: initial?.cliente_numero || '',
      cliente_complemento: initial?.cliente_complemento || '',
      cliente_cep: initial?.cliente_cep || '',
      cliente_cod_municipio: initial?.cliente_cod_municipio || '',
      cliente_im: initial?.cliente_im || '',
      cliente_email: initial?.cliente_email || '',
      cliente_telefone: initial?.cliente_telefone || '',
      pagador_nome: initial?.pagador_nome || '',
      pagador_cnpj: initial?.pagador_cnpj || '',
      description: initial?.description || '',
      aliquota_iss: num(initial?.aliquota_iss) || 5,
      iss_retido: initial?.iss_retido ?? false,
      valor_servicos: num(initial?.valor_servicos),
      valor_deducoes: num(initial?.valor_deducoes),
      valor_pis: num(initial?.valor_pis),
      valor_cofins: num(initial?.valor_cofins),
      valor_inss: num(initial?.valor_inss),
      valor_ir: num(initial?.valor_ir),
      valor_csll: num(initial?.valor_csll),
      outras_retencoes: num(initial?.outras_retencoes),
      notes: initial?.notes || '',
      load_id: loadId ?? initial?.load_id ?? null,
      related_cte_ids: initial?.related_cte_ids || [],
    });
    setItems(
      initial?.items?.map((item) => ({
        description: item.description || '',
        quantity: num(item.quantity),
        unit_value: num(item.unit_value),
        total: num(item.total),
        fiscal_document_id: item.fiscal_document_id,
        access_key: item.access_key,
      })) ?? [],
    );
  }, [open, initial, loadId]);

  useEffect(() => {
    if (!open || form.emitter_id) return;
    const defaultEmitter = emitters.find(emitter => emitter.active && emitter.is_default) || emitters.find(emitter => emitter.active);
    if (!defaultEmitter) return;
    setForm(current => ({
      ...current,
      emitter_id: defaultEmitter.id,
      branch_code: defaultEmitter.branch_code || current.branch_code,
      regime_tributario: defaultEmitter.regime_tributario || current.regime_tributario,
    }));
  }, [open, emitters, form.emitter_id]);

  const formTomador = useMemo(() => tomadorFromForm(form), [form]);
  const missingTomadorFields = useMemo(
    () => missingNFSeTomadorFields(formTomador),
    [formTomador],
  );
  const needsTomadorRegistryEnrichment = useMemo(
    () => needsNFSeTomadorRegistryEnrichment(formTomador),
    [formTomador],
  );

  const completeTomadorAddress = useCallback(async (forceRefresh = false) => {
    const emitterId = form.emitter_id;
    const cnpj = onlyDigits(form.cliente_cnpj);
    const uf = normalizeUf(form.cliente_uf) || '';
    if (!emitterId || cnpj.length !== 14 || !uf) {
      setRegistryStatus('error');
      setRegistryMessage('Informe emitente, CNPJ e UF para consultar o endereço fiscal.');
      return;
    }

    const requestId = ++registryRequestRef.current;
    setRegistryStatus('loading');
    setRegistryMessage('Consultando o cadastro fiscal do tomador…');
    try {
      const result = await consultOfficialTaxRegistry({
        emitterId,
        uf,
        lookupValue: cnpj,
        lookupType: 'CNPJ',
        environment: 'production',
        forceRefresh,
      });
      if (registryRequestRef.current !== requestId) return;
      const profile = findActiveNFSeTaxProfile(cnpj, result.profiles);
      if (!profile) throw new Error('CNPJ não localizado como ativo no cadastro fiscal.');
      const remaining = missingNFSeTomadorFields(
        mergeOfficialProfileIntoNFSeTomador(formTomador, profile, uf),
      );
      setForm(current => {
        const completed = mergeOfficialProfileIntoNFSeTomador(tomadorFromForm(current), profile, uf);
        return applyTomadorToForm(current, completed);
      });
      if (remaining.length) throw new Error(`Cadastro fiscal não retornou: ${remaining.join(', ')}.`);
      const completedForValidation = mergeOfficialProfileIntoNFSeTomador(formTomador, profile, uf);
      if (!sanitizeIe(completedForValidation.ie)) {
        throw new Error('Cadastro fiscal não retornou a IE. Informe a IE ou marque como ISENTO antes de continuar.');
      }
      setRegistryStatus('filled');
      setRegistryMessage('IE e endereço do tomador conferidos no cadastro fiscal.');
    } catch (error: unknown) {
      if (registryRequestRef.current !== requestId) return;
      setRegistryStatus('error');
      setRegistryMessage(errorMessage(error));
    }
  }, [form.emitter_id, form.cliente_cnpj, form.cliente_uf, formTomador]);

  useEffect(() => {
    if (!open || environment !== 'production' || !needsTomadorRegistryEnrichment) return;
    const emitterId = form.emitter_id || '';
    const cnpj = onlyDigits(form.cliente_cnpj);
    const uf = normalizeUf(form.cliente_uf) || '';
    if (!emitterId || cnpj.length !== 14 || !uf) return;
    const attemptKey = `${emitterId}|${cnpj}|${uf}`;
    if (registryAttemptRef.current === attemptKey) return;
    registryAttemptRef.current = attemptKey;
    void completeTomadorAddress(false);
  }, [open, environment, form.emitter_id, form.cliente_cnpj, form.cliente_uf, needsTomadorRegistryEnrichment, completeTomadorAddress]);

  const totalServicos = items.length > 0
    ? items.reduce((a, it) => a + num(it.total), 0)
    : num(form.valor_servicos);
  const baseCalculo = Math.max(0, totalServicos - num(form.valor_deducoes));
  const valorIss = +(baseCalculo * num(form.aliquota_iss) / 100).toFixed(2);
  const valorLiquido = +(totalServicos
    - (form.iss_retido ? valorIss : 0)
    - num(form.valor_pis) - num(form.valor_cofins) - num(form.valor_inss)
    - num(form.valor_ir) - num(form.valor_csll) - num(form.outras_retencoes)).toFixed(2);

  const setField = <K extends keyof NFSeFormState>(key: K, value: NFSeFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const addItem = () => setItems(arr => [...arr, { description: '', quantity: 1, unit_value: 0, total: 0 }]);
  const updateItem = (i: number, patch: Partial<NFSeItem>) => {
    setItems(arr => arr.map((it, idx) => {
      if (idx !== i) return it;
      const merged = { ...it, ...patch };
      merged.total = +(num(merged.quantity) * num(merged.unit_value)).toFixed(2);
      return merged;
    }));
  };
  const removeItem = (i: number) => {
    const documentId = items[i]?.fiscal_document_id;
    if (documentId) {
      const next = new Set(selectedIds);
      next.delete(documentId);
      applyDocumentSelection(next);
      return;
    }
    setItems(current => current.filter((_, index) => index !== i));
  };

  const handleFetchFromInvoice = async () => {
    if (!invoiceSearch) {
      toast.error('Informe o número ou chave da NF');
      return;
    }

    setLoadingInvoice(true);
    try {
      const search = invoiceSearch.trim();
      const doc = allDocs.find(d =>
        d.invoice_number === search ||
        d.access_key === search ||
        (d.access_key && d.access_key.endsWith(search))
      );

      if (!doc) {
        toast.error('Nota fiscal não encontrada');
        return;
      }

      const tomador = resolveNFSeTomador(doc, 'destinatario', clients);

      // Preenche os dados do tomador
      setForm(prev => ({
        ...prev,
      cliente_id: tomador.cliente_id || doc.client_id || null,
      cliente_nome: tomador.nome,
      cliente_cnpj: tomador.cnpj,
      cliente_ie: tomador.ie,
      cliente_im: tomador.im,
      cliente_municipio: tomador.municipio,
      cliente_uf: tomador.uf,
      cliente_bairro: tomador.bairro,
      cliente_endereco: tomador.endereco,
      cliente_numero: tomador.numero,
      cliente_complemento: tomador.complemento,
      cliente_cep: tomador.cep,
      cliente_cod_municipio: tomador.municipio_cod,
      cliente_email: tomador.email,
      cliente_telefone: tomador.telefone,
        reference_number: doc.invoice_number || prev.reference_number,
        valor_servicos: num(doc.freight_value || doc.value || 0),
        description: `Serviço de transporte ref. NF ${doc.invoice_number || ''}`,
        notes: `NFS-e referente a(s) NF ${doc.invoice_number || ''}`
      }));

      const serviceValue = num(doc.freight_value || doc.value || 0);
      setItems([{
        description: `Serviço de transporte ref. NF ${doc.invoice_number || ''}`,
        quantity: 1,
        unit_value: serviceValue,
        total: serviceValue,
        fiscal_document_id: doc.id,
        access_key: doc.access_key,
      }]);
      setSelectedIds(new Set([doc.id]));

      toast.success('Dados importados da NF');
    } catch {
      toast.error('Erro ao buscar dados da NF');
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleSelectClient = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    setForm(prev => ({
      ...prev,
      cliente_id: client.id,
      cliente_nome: client.company_name,
      cliente_cnpj: client.tax_id || '',
      cliente_ie: sanitizeIe(client.state_registration) || '',
      cliente_im: client.municipal_registration || '',
      cliente_endereco: client.address_street || '',
      cliente_numero: client.address_number || '',
      cliente_complemento: client.address_complement || '',
      cliente_bairro: client.address_neighborhood || '',
      cliente_municipio: normalizeCityName(client.address_city) || '',
      cliente_cod_municipio: normalizeIbgeCity(client.address_city_ibge_code) || '',
      cliente_uf: normalizeUf(client.address_state) || '',
      cliente_cep: normalizeCep(client.address_zip) || '',
      cliente_email: client.email || '',
      cliente_telefone: normalizePhone(client.phone) || '',
    }));
    setClientSearchOpen(false);
    setClientSearchTerm('');
    toast.info('Dados do tomador preenchidos');
  };

  const handleSave = async () => {
    let preparedForm = form;
    if (environment === 'production' && needsNFSeTomadorRegistryEnrichment(formTomador)) {
      try {
        const emitterId = form.emitter_id || '';
        const cnpj = onlyDigits(form.cliente_cnpj);
        const uf = normalizeUf(form.cliente_uf) || '';
        if (!emitterId || cnpj.length !== 14 || !uf) {
          throw new Error('Informe emitente, CNPJ e UF para completar IE/endereço do tomador.');
        }
        const result = await consultOfficialTaxRegistry({
          emitterId, uf, lookupValue: cnpj, lookupType: 'CNPJ', environment: 'production',
        });
        const profile = findActiveNFSeTaxProfile(cnpj, result.profiles);
        if (!profile) throw new Error('CNPJ do tomador não localizado como ativo no cadastro fiscal.');
        const completed = mergeOfficialProfileIntoNFSeTomador(formTomador, profile, uf);
        const missing = missingNFSeTomadorFields(completed);
        if (missing.length > 0) throw new Error(`Cadastro fiscal não retornou: ${missing.join(', ')}.`);
        if (!sanitizeIe(completed.ie)) {
          throw new Error('IE do tomador não localizada. Informe a IE ou marque como ISENTO antes de continuar.');
        }
        preparedForm = applyTomadorToForm(form, completed);
        setForm(preparedForm);
      } catch (error: unknown) {
        toast.error(errorMessage(error));
        return;
      }
    }

    if (!preparedForm.cliente_nome) { toast.warning('Tomador (cliente) não informado.'); }
    if (!preparedForm.cliente_municipio) { toast.warning('Município do tomador não informado.'); }
    const normalizedCityCode = normalizeIbgeCity(preparedForm.cliente_cod_municipio) || normalizeIbgeCity(preparedForm.cliente_municipio);
    if (!normalizedCityCode) {
      toast.warning('Código IBGE do município não informado.');
    }
    if (!normalizeCep(preparedForm.cliente_cep)) { toast.warning('CEP do tomador inválido ou ausente.'); }
    if (!normalizeUf(preparedForm.cliente_uf)) { toast.warning('UF do tomador inválida ou ausente.'); }
    if (totalServicos <= 0) { toast.warning('Valor de serviços é zero.'); }
    const fiscalDocumentIds = [...selectedIds];
    const payload: Partial<NFSeDoc> = {
      ...preparedForm,
      cliente_cep: normalizeCep(preparedForm.cliente_cep),
      cliente_cod_municipio: normalizedCityCode,
      items,
      valor_servicos: totalServicos,
      base_calculo: baseCalculo,
      valor_iss: valorIss,
      valor_liquido: valorLiquido,
      fiscal_document_ids: fiscalDocumentIds,
      valor_total: totalServicos,
    };
    try {
      const saved = editing
        ? await update.mutateAsync({ id: initial!.id!, patch: payload })
        : await create.mutateAsync(payload);
      toast.success(editing ? 'NFS-e atualizada' : `RPS ${saved.rps_number} criado`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar NFS-e (RPS)' : 'Nova NFS-e (RPS)'}</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <FiscalEnvironmentSelect
            value={environment}
            onChange={onEnvironmentChange}
            disabled={issuing || create.isPending || update.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Ambiente para emitir nesta tela. Salvar o RPS cria um rascunho; para transmitir, use Emitir após salvar.
          </p>
        </div>

        <Tabs defaultValue="gerais">
          <TabsList>
            <TabsTrigger value="gerais">Dados Gerais</TabsTrigger>
            <TabsTrigger value="comp">Dados Comp.</TabsTrigger>
            <TabsTrigger value="itens">Itens / Valores</TabsTrigger>
          </TabsList>

          <TabsContent value="gerais" className="space-y-4 pt-4">
            <div className="flex items-end gap-2 p-3 bg-muted/30 rounded-lg border border-dashed mb-2">
              <div className="flex-1">
                <Label className="text-xs">Importar dados de uma NF-e</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nº da NF ou Chave de Acesso"
                    value={invoiceSearch}
                    onChange={e => setInvoiceSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFetchFromInvoice()}
                  />
                  <Button variant="secondary" onClick={handleFetchFromInvoice} disabled={loadingInvoice}>
                    {loadingInvoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                    Puxar dados
                  </Button>
                </div>
              </div>
            </div>

            {loadId && (
              <div className="space-y-3 border p-3 rounded-md bg-muted/30 mb-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase">NF-es da Carga</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectAll}>
                    {selectedIds.size === filteredDocs.length && filteredDocs.length > 0 ? 'Desmarcar' : 'Selecionar'} Todas
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input
                      placeholder="Filtrar Nota..."
                      className="h-8 pl-7 text-xs"
                      value={filters.invoice}
                      onChange={e => setFilters(f => ({ ...f, invoice: e.target.value }))}
                    />
                  </div>
                  <Input
                    placeholder="Filtrar Destinatário..."
                    className="h-8 text-xs"
                    value={filters.recipient}
                    onChange={e => setFilters(f => ({ ...f, recipient: e.target.value }))}
                  />
                </div>

                <div className="max-h-[150px] overflow-y-auto border rounded divide-y bg-background">
                  {loadDocumentsQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground" role="status">
                      <Loader2 className="h-3 w-3 animate-spin" /> Consultando NF-es da carga…
                    </div>
                  ) : loadDocumentsQuery.isError ? (
                    <div className="space-y-2 p-4 text-center text-xs" role="alert">
                      <p>Não foi possível consultar as NF-es da carga.</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => void loadDocumentsQuery.refetch()} disabled={loadDocumentsQuery.isFetching}>
                        {loadDocumentsQuery.isFetching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                        Tentar novamente
                      </Button>
                    </div>
                  ) : filteredDocs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">Nenhuma NF encontrada.</div>
                  ) : filteredDocs.map(d => (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 p-2 hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        const next = new Set(selectedIds);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        applyDocumentSelection(next);
                      }}
                    >
                      <Checkbox checked={selectedIds.has(d.id)} onCheckedChange={() => {}} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-[11px] font-medium">
                          <span>NF {d.invoice_number}</span>
                          <span>R$ {Number(d.freight_value || 0).toFixed(2)}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{d.recipient}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3">
                <Label>Emitente Fiscal</Label>
                <Select value={form.emitter_id || ''} onValueChange={v => {
                  const em = emitters.find(e => e.id === v);
                  setField('emitter_id', v);
                  if (em?.branch_code) setField('branch_code', em.branch_code);
                  if (em?.regime_tributario) setField('regime_tributario', em.regime_tributario);
                }}>
                  <SelectTrigger><SelectValue placeholder={emitters.length ? 'Selecione o emitente' : 'Cadastre um emitente em Configurações'} /></SelectTrigger>
                  <SelectContent>
                    {emitters.filter(e => e.active).map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.razao_social} — CNPJ {e.cnpj} {e.is_default ? '(padrão)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Tipo Doc</Label><Input value={form.doc_type || ''} onChange={e => setField('doc_type', e.target.value)} /></div>
              <div><Label>Série</Label><Input value={form.series || ''} onChange={e => setField('series', e.target.value)} /></div>
              <div><Label>Filial</Label><Input value={form.branch_code || ''} onChange={e => setField('branch_code', e.target.value)} disabled={!!form.emitter_id} /></div>
              <div><Label>Situação Doc</Label><Input value={form.situacao_doc || ''} onChange={e => setField('situacao_doc', e.target.value)} /></div>
              <div><Label>Data Emissão</Label><Input type="date" value={form.issue_date || ''} onChange={e => setField('issue_date', e.target.value)} /></div>
              <div className="flex items-end gap-2"><Checkbox checked={!!form.is_preview} onCheckedChange={v => setField('is_preview', !!v)} /><Label>Previsão</Label></div>

              <div className="col-span-2"><Label>Nº Ref</Label><Input value={form.reference_number || ''} onChange={e => setField('reference_number', e.target.value)} /></div>
              <div className="col-span-2"><Label>Pedido</Label><Input value={form.pedido || ''} onChange={e => setField('pedido', e.target.value)} /></div>
              <div className="col-span-2"><Label>Cond. Pagto</Label><Input value={form.cond_pagamento || ''} onChange={e => setField('cond_pagamento', e.target.value)} /></div>

              <div className="col-span-2"><Label>Cód. Serviço Nacional (6 dígitos)</Label><Input inputMode="numeric" maxLength={6} placeholder="Ex.: 160201" value={form.cod_servico || ''} onChange={e => setField('cod_servico', e.target.value)} /></div>
              <div className="col-span-2"><Label>CNAE</Label><Input value={form.cnae || ''} onChange={e => setField('cnae', e.target.value)} /></div>
              <div className="col-span-2"><Label>Nat. Operação</Label><Input value={form.nat_operacao || ''} onChange={e => setField('nat_operacao', e.target.value)} /></div>

              <div className="col-span-2"><Label>Cód. Trib. Municipal</Label><Input value={form.cod_trib_municipal || ''} onChange={e => setField('cod_trib_municipal', e.target.value)} /></div>
              <div className="col-span-2"><Label>Cód. Mun. Prestação</Label><Input value={form.cod_municipio_prestacao || ''} onChange={e => setField('cod_municipio_prestacao', e.target.value)} /></div>
              <div className="col-span-2"><Label>Tipo CTRC</Label><Input value={form.tipo_ctrc || ''} onChange={e => setField('tipo_ctrc', e.target.value)} /></div>
              <div className="col-span-2">
                <Label>Regime Tributário</Label>
                <Select value={form.regime_tributario || '3'} onValueChange={v => setField('regime_tributario', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Simples Nacional</SelectItem>
                    <SelectItem value="3">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between pt-2">
                <div>
                  <h4 className="font-semibold text-sm text-primary">Tomador (Cliente)</h4>
                  {registryStatus !== 'idle' && (
                    <p role={registryStatus === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs ${registryStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {registryMessage}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {missingTomadorFields.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        registryAttemptRef.current = '';
                        void completeTomadorAddress(true);
                      }}
                      disabled={registryStatus === 'loading' || !form.emitter_id || onlyDigits(form.cliente_cnpj).length !== 14 || !normalizeUf(form.cliente_uf)}
                    >
                      {registryStatus === 'loading' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                      Completar endereço
                    </Button>
                  )}
                  <Popover
                  modal
                  open={clientSearchOpen}
                  onOpenChange={(v) => {
                    setClientSearchOpen(v);
                    if (v && clientsError) void refetchClients();
                    if (!v) setClientSearchTerm('');
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2">
                      <UserSearch className="h-4 w-4" />
                      Pesquisar Cliente/Fornecedor
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[400px]" align="end">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Buscar por nome ou CNPJ..."
                        value={clientSearchTerm}
                        onValueChange={setClientSearchTerm}
                      />
                      <CommandList>
                        {clientsLoading ? (
                          <div role="status" className="py-6 text-center text-sm">Carregando clientes e fornecedores...</div>
                        ) : clientsError ? (
                          <div role="alert" className="p-4 text-center text-sm">
                            Não foi possível carregar os clientes e fornecedores.
                            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void refetchClients()}>
                              Tentar novamente
                            </Button>
                          </div>
                        ) : (
                          <CommandEmpty>Nenhum registro encontrado.</CommandEmpty>
                        )}
                        <CommandGroup>
                          {filteredClientOptions.map((opt) => (
                            <CommandItem
                              key={opt.value}
                              value={opt.value}
                              onSelect={() => handleSelectClient(opt.value)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.cliente_id === opt.value ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {opt.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-3"><Label>Nome</Label><Input value={form.cliente_nome || ''} onChange={e => setField('cliente_nome', e.target.value)} /></div>
                <div className="col-span-2"><Label>CNPJ</Label><Input value={form.cliente_cnpj || ''} onChange={e => setField('cliente_cnpj', e.target.value)} /></div>
                <div><Label>IE</Label><Input value={form.cliente_ie || ''} onChange={e => setField('cliente_ie', e.target.value)} /></div>
                <div className="col-span-3"><Label>Endereço</Label><Input value={form.cliente_endereco || ''} onChange={e => setField('cliente_endereco', e.target.value)} /></div>
                <div className="col-span-2"><Label>Bairro</Label><Input value={form.cliente_bairro || ''} onChange={e => setField('cliente_bairro', e.target.value)} /></div>
                <div><Label>UF</Label><Input value={form.cliente_uf || ''} onChange={e => setField('cliente_uf', e.target.value)} /></div>
                <div className="col-span-3"><Label>Município</Label><Input value={form.cliente_municipio || ''} onChange={e => setField('cliente_municipio', e.target.value)} /></div>
                <div><Label>Número</Label><Input value={form.cliente_numero || ''} onChange={e => setField('cliente_numero', e.target.value)} /></div>
                <div className="col-span-2"><Label>Complemento</Label><Input value={form.cliente_complemento || ''} onChange={e => setField('cliente_complemento', e.target.value)} /></div>
                <div><Label>CEP</Label><Input value={form.cliente_cep || ''} maxLength={9} onChange={e => setField('cliente_cep', e.target.value)} /></div>
                <div className="col-span-2"><Label>Cód. IBGE Município</Label><Input value={form.cliente_cod_municipio || ''} maxLength={7} onChange={e => setField('cliente_cod_municipio', e.target.value)} /></div>
                <div><Label>IM</Label><Input value={form.cliente_im || ''} onChange={e => setField('cliente_im', e.target.value)} /></div>
                <div className="col-span-2"><Label>E-mail</Label><Input value={form.cliente_email || ''} onChange={e => setField('cliente_email', e.target.value)} /></div>
                <div className="col-span-2"><Label>Telefone</Label><Input value={form.cliente_telefone || ''} onChange={e => setField('cliente_telefone', e.target.value)} /></div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comp" className="space-y-4 pt-4">
            <h4 className="font-semibold text-sm">Pagador (se diferente do tomador)</h4>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3"><Label>Nome</Label><Input value={form.pagador_nome || ''} onChange={e => setField('pagador_nome', e.target.value)} /></div>
              <div className="col-span-2"><Label>CNPJ</Label><Input value={form.pagador_cnpj || ''} onChange={e => setField('pagador_cnpj', e.target.value)} /></div>
            </div>
            <div>
              <Label>Discriminação dos Serviços</Label>
              <Textarea rows={5} value={form.description || ''} onChange={e => setField('description', e.target.value)} />
            </div>
            <div>
              <Label>Observações internas</Label>
              <Textarea rows={3} value={form.notes || ''} onChange={e => setField('notes', e.target.value)} />
            </div>
          </TabsContent>

          <TabsContent value="itens" className="space-y-4 pt-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">Itens da Nota</h4>
              <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-3 w-3 mr-1" /> Adicionar item</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-24">Qtd</TableHead>
                  <TableHead className="w-32">Vl. Unit.</TableHead>
                  <TableHead className="w-32">Total</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-4">Nenhum item — informe o valor de serviços abaixo</TableCell></TableRow>
                )}
                {items.map((it, i) => (
                  <TableRow key={i}>
                    <TableCell><Input value={it.description} onChange={e => updateItem(i, { description: e.target.value })} /></TableCell>
                    <TableCell><Input type="number" value={it.quantity} onChange={e => updateItem(i, { quantity: +e.target.value })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={it.unit_value} onChange={e => updateItem(i, { unit_value: +e.target.value })} /></TableCell>
                    <TableCell className="text-right tabular-nums">R$ {it.total.toFixed(2)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => removeItem(i)}><Trash2 className="h-3 w-3" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="grid grid-cols-4 gap-3 pt-2">
              <div><Label>Vl. Serviços (manual)</Label><Input type="number" step="0.01" disabled={items.length > 0} value={form.valor_servicos || 0} onChange={e => setField('valor_servicos', +e.target.value)} /></div>
              <div><Label>Deduções</Label><Input type="number" step="0.01" value={form.valor_deducoes || 0} onChange={e => setField('valor_deducoes', +e.target.value)} /></div>
              <div><Label>Alíquota ISS (%)</Label><Input type="number" step="0.0001" value={form.aliquota_iss || 0} onChange={e => setField('aliquota_iss', +e.target.value)} /></div>
              <div className="flex items-end gap-2"><Checkbox checked={!!form.iss_retido} onCheckedChange={v => setField('iss_retido', !!v)} /><Label>ISS Retido</Label></div>

              <div><Label>PIS</Label><Input type="number" step="0.01" value={form.valor_pis || 0} onChange={e => setField('valor_pis', +e.target.value)} /></div>
              <div><Label>COFINS</Label><Input type="number" step="0.01" value={form.valor_cofins || 0} onChange={e => setField('valor_cofins', +e.target.value)} /></div>
              <div><Label>INSS</Label><Input type="number" step="0.01" value={form.valor_inss || 0} onChange={e => setField('valor_inss', +e.target.value)} /></div>
              <div><Label>IR</Label><Input type="number" step="0.01" value={form.valor_ir || 0} onChange={e => setField('valor_ir', +e.target.value)} /></div>
              <div><Label>CSLL</Label><Input type="number" step="0.01" value={form.valor_csll || 0} onChange={e => setField('valor_csll', +e.target.value)} /></div>
              <div><Label>Outras retenções</Label><Input type="number" step="0.01" value={form.outras_retencoes || 0} onChange={e => setField('outras_retencoes', +e.target.value)} /></div>
            </div>

            <div className="rounded-md border p-3 grid grid-cols-4 gap-3 bg-muted/30">
              <div><div className="text-xs text-muted-foreground">Vl. Serviços</div><div className="font-semibold tabular-nums">R$ {totalServicos.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Base Cálculo</div><div className="font-semibold tabular-nums">R$ {baseCalculo.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Vl. ISS</div><div className="font-semibold tabular-nums">R$ {valorIss.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Vl. Líquido</div><div className="font-semibold tabular-nums">R$ {valorLiquido.toFixed(2)}</div></div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
            {editing ? 'Salvar alterações' : 'Criar RPS (rascunho)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
