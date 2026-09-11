import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, ArrowRight, ArrowLeft, FileText } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useBillingDocuments } from '@/hooks/useBillingDocuments';
import { normalizeCep, normalizeIbgeCity } from '@/lib/fiscal/fiscalAddress';
import { resolveNFSeTomador, type TomadorData } from '@/lib/fiscal/nfseTomador';
import { useClients } from '@/hooks/useClients';
import { useEmitters } from '@/hooks/useEmitters';
import { useCreateNFSe, useIssueNFSeBatch, type NFSeDoc } from '@/hooks/useNFSe';
import type { FiscalDocument } from '@/hooks/useFiscalDocuments';
import { useRecalculateInboundFreight } from '@/hooks/useRecalculateInboundFreight';
import { formatCnpj, validateInsurance } from '@/lib/fiscal/insuranceValidation';
import { hasInsuranceData } from '@/lib/fiscal/insuranceText';
import { hasInsuranceProfile } from '@/lib/fiscal/insuranceProfile';
import { Calculator, Save } from 'lucide-react';
import { useInsuranceProfile, useUpdateInsuranceProfile } from '@/hooks/useInsuranceProfile';
import { FiscalEnvironmentSelect } from '@/components/fiscal/FiscalEnvironmentSelect';
import type { HubEnvironment, NFSeBatchResponse } from '@/lib/fiscal/hubFiscalClient';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { allocateCurrency } from '@/lib/fiscal/nfseBatchAllocation';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const SENTINEL_NONE = '__none__';
type EmissionMode = 'individual' | 'unified';
interface BatchAttempt {
  mode: EmissionMode;
  requestId: string;
  environment: HubEnvironment;
  sourceCount: number;
  drafts: Record<string, { nfseDocumentId: string; label: string }>;
}

function num(value: unknown) { return Number(value ?? 0) || 0; }
function onlyDigits(value: unknown) { return String(value ?? '').replace(/\D/g, ''); }

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Falha ao processar emissão(ões)';
}

function normalizedPartyIdentity(party: TomadorData): string {
  return [
    onlyDigits(party.cnpj),
    String(party.nome || '').trim().toLocaleUpperCase('pt-BR'),
    onlyDigits(party.ie),
    String(party.endereco || '').trim().toLocaleUpperCase('pt-BR'),
    String(party.numero || '').trim().toLocaleUpperCase('pt-BR'),
    normalizeCep(party.cep),
    normalizeIbgeCity(party.municipio_cod) || String(party.municipio || '').trim().toLocaleUpperCase('pt-BR'),
    String(party.uf || '').trim().toLocaleUpperCase('pt-BR'),
  ].join('|');
}

function isStoredBatchAttempt(value: unknown): value is BatchAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<BatchAttempt>;
  if (!['individual', 'unified'].includes(String(attempt.mode)) ||
    !['sandbox', 'homologation', 'production'].includes(String(attempt.environment)) ||
    typeof attempt.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(attempt.requestId) ||
    !Number.isInteger(attempt.sourceCount) || Number(attempt.sourceCount) < 1 ||
    !attempt.drafts || typeof attempt.drafts !== 'object') return false;
  const drafts = Object.values(attempt.drafts);
  return drafts.length > 0 && drafts.every(draft =>
    Boolean(draft) && typeof draft.nfseDocumentId === 'string' && /^[0-9a-f-]{36}$/i.test(draft.nfseDocumentId) &&
    typeof draft.label === 'string' && draft.label.length <= 500,
  );
}

export default function NFSeFromInvoicesDialog({ open, onOpenChange }: Props) {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: clients = [] } = useClients();
  const { data: emitters = [] } = useEmitters();
  const create = useCreateNFSe();
  const [environment, setEnvironment] = useState<HubEnvironment>('production');
  const issueBatch = useIssueNFSeBatch(environment);
  const recalcFreight = useRecalculateInboundFreight();
  const { data: insuranceProfile } = useInsuranceProfile();
  const saveInsuranceProfile = useUpdateInsuranceProfile();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [supplierId, setSupplierId] = useState<string>(SENTINEL_NONE);
  const [clientId, setClientId] = useState<string>(SENTINEL_NONE);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [recipientCity, setRecipientCity] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Passo 2 — valor de serviço editável por NF (pré-preenchido com o frete)
  const [serviceValues, setServiceValues] = useState<Record<string, number>>({});

  // Step 2 — dados fiscais da NFS-e
  const [emitterId, setEmitterId] = useState<string>('');
  const [regimeTributario, setRegimeTributario] = useState<string>('3'); // 3 = Normal, 1 = Simples Nacional
  const [aliquotaIss, setAliquotaIss] = useState<number>(5);
  const [issRetido, setIssRetido] = useState(false);
  const [codServico, setCodServico] = useState('');
  const [cnae, setCnae] = useState('');
  const [natOperacao, setNatOperacao] = useState('1'); // 1 = Tributação no município (Normal)
  const [descricao, setDescricao] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [tomadorMode, setTomadorMode] = useState<'remetente' | 'destinatario'>('remetente');
  const [issuing, setIssuing] = useState(false);
  // Retenções e deduções (opcionais)
  const [valorDeducoes, setValorDeducoes] = useState<number>(0);
  const [aliqPis, setAliqPis] = useState<number>(0);
  const [aliqCofins, setAliqCofins] = useState<number>(0);
  const [aliqInss, setAliqInss] = useState<number>(0);
  const [aliqIr, setAliqIr] = useState<number>(0);
  const [aliqCsll, setAliqCsll] = useState<number>(0);
  const [outrasRetencoes, setOutrasRetencoes] = useState<number>(0);
  // Seguro da carga (mesmos campos do CT-e)
  const [insurerName, setInsurerName] = useState('');
  const [insurerCnpj, setInsurerCnpj] = useState('');
  const [insurerPolicy, setInsurerPolicy] = useState('');
  const [insurerEndorsement, setInsurerEndorsement] = useState('');
  const [insuredAmount, setInsuredAmount] = useState<number>(0);
  const [insurancePremium, setInsurancePremium] = useState<number>(0);
  const [observacoes, setObservacoes] = useState('');
  const [manualTomador, setManualTomador] = useState<TomadorData | null>(null);
  const [isEditingTomador, setIsEditingTomador] = useState(false);
  const [emissionMode, setEmissionMode] = useState<EmissionMode | null>(null);
  const [batchAttempt, setBatchAttempt] = useState<BatchAttempt | null>(null);
  const [batchResult, setBatchResult] = useState<NFSeBatchResponse | null>(null);
  const batchStorageKey = useMemo(
    () => currentTenant?.id && user?.id ? `agvlog:nfse-batch:${currentTenant.id}:${user.id}` : null,
    [currentTenant?.id, user?.id],
  );

  const suppliers = useMemo(() => clients.filter((client) => client.is_supplier), [clients]);
  const clientList = useMemo(() => clients.filter((client) => client.is_client !== false), [clients]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelected({});
    setDescricao('');
    setObservacoes('');
    setServiceValues({});
    setManualTomador(null);
    setIsEditingTomador(false);
    setEmissionMode(null);
    setBatchAttempt(null);
    setBatchResult(null);
    if (batchStorageKey) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(batchStorageKey) || 'null') as BatchAttempt | null;
        if (isStoredBatchAttempt(stored)) {
          setBatchAttempt(stored);
          setEmissionMode(stored.mode);
          setEnvironment(stored.environment);
          setStep(3);
        }
      } catch {
        sessionStorage.removeItem(batchStorageKey);
      }
    }
    const defEm = emitters.find(e => e.active && e.is_default) || emitters.find(e => e.active);
    if (defEm) {
      setEmitterId(defEm.id);
      setRegimeTributario(defEm.regime_tributario || '3');
    }
  }, [open, emitters, batchStorageKey]);

  useEffect(() => {
    if (!batchStorageKey || !batchAttempt) return;
    sessionStorage.setItem(batchStorageKey, JSON.stringify(batchAttempt));
  }, [batchAttempt, batchStorageKey]);

  const filters = useMemo(() => ({
    supplierId: supplierId !== SENTINEL_NONE ? supplierId : null,
    clientId: clientId !== SENTINEL_NONE ? clientId : null,
    periodStart: periodStart || null,
    periodEnd: periodEnd || null,
    invoiceNumber: invoiceNumber || null,
    recipientCity: recipientCity || null,
  }), [supplierId, clientId, periodStart, periodEnd, invoiceNumber, recipientCity]);

  const { data: docs = [], isLoading, isFetching, error: docsError, refetch } = useBillingDocuments(filters, 'nfse');

  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const showAllPending = () => {
    setSupplierId(SENTINEL_NONE); setClientId(SENTINEL_NONE);
    setPeriodStart(''); setPeriodEnd(''); setInvoiceNumber(''); setRecipientCity('');
    setSelected({});
    void refetch();
  };

  const selectedDocs = useMemo(
    () => docs.filter((document) => selected[document.id]),
    [docs, selected],
  );

  const valorPorDoc = useCallback((document: FiscalDocument) => {
    const override = serviceValues[document.id];
    if (override !== undefined) return num(override);
    return num(document.freight_value ?? document.value ?? 0);
  }, [serviceValues]);
  const totalServicos = useMemo(
    () => selectedDocs.reduce((total, document) => total + valorPorDoc(document), 0),
    [selectedDocs, valorPorDoc],
  );
  const baseCalculo = +(Math.max(0, totalServicos - num(valorDeducoes))).toFixed(2);
  const valorIss = +(baseCalculo * num(aliquotaIss) / 100).toFixed(2);
  const valorPis = +(baseCalculo * num(aliqPis) / 100).toFixed(2);
  const valorCofins = +(baseCalculo * num(aliqCofins) / 100).toFixed(2);
  const valorInss = +(baseCalculo * num(aliqInss) / 100).toFixed(2);
  const valorIr = +(baseCalculo * num(aliqIr) / 100).toFixed(2);
  const valorCsll = +(baseCalculo * num(aliqCsll) / 100).toFixed(2);
  const totalRetencoes = +(
    (issRetido ? valorIss : 0) + valorPis + valorCofins + valorInss + valorIr + valorCsll + num(outrasRetencoes)
  ).toFixed(2);
  const valorLiquido = +(totalServicos - num(valorDeducoes) - totalRetencoes).toFixed(2);

  const missingFreight = selectedDocs.filter((document) => num(document.freight_value) <= 0).length;

  // Pré-preenche o seguro a partir das NFs selecionadas (snapshot da emissão fiscal)
  useEffect(() => {
    const src = selectedDocs.find((document) => document.insurer_policy || document.insurer_name || document.insurer_cnpj);
    if (!src) return;
    setInsurerName((v) => v || src.insurer_name || '');
    setInsurerCnpj((v) => v || formatCnpj(src.insurer_cnpj || ''));
    setInsurerPolicy((v) => v || src.insurer_policy || '');
    setInsurerEndorsement((v) => v || src.insurer_endorsement || '');
    setInsuredAmount((v) => v || num(src.insured_amount));
    setInsurancePremium((v) => v || num(src.insurance_premium));
  }, [selectedDocs]);

  const insuranceCheck = useMemo(
    () =>
      hasInsuranceData({
        insurer_name: insurerName,
        insurer_cnpj: insurerCnpj,
        insurer_policy: insurerPolicy,
        insurer_endorsement: insurerEndorsement,
        insured_amount: insuredAmount,
        insurance_premium: insurancePremium,
      })
        ? validateInsurance({ name: insurerName, cnpj: insurerCnpj, policy: insurerPolicy, endorsement: insurerEndorsement })
        : { ok: true, errors: {}, messages: [] },
    [insurerName, insurerCnpj, insurerPolicy, insurerEndorsement, insuredAmount, insurancePremium],
  );

  // Spinner do botão só reflete recálculo manual (clique do usuário).
  // O auto-recálculo em background não deve prender o botão.
  const [manualRecalcing, setManualRecalcing] = useState(false);

  async function handleRecalc() {
    const ids = selectedDocs.map((document) => document.id);
    if (!ids.length) { toast.error('Selecione ao menos uma NF para recalcular'); return; }
    setManualRecalcing(true);
    try {
      const res = await recalcFreight.mutateAsync(ids);
      toast.success(`Frete recalculado: ${res.updated} atualizadas, ${res.skipped} com override, ${res.failed} falharam`);
    } finally {
      setManualRecalcing(false);
    }
  }

  // Recálculo de frete é somente manual (botão "Recalcular frete").
  // Auto-recálculo em background foi removido para não bloquear a função quando
  // o usuário precisa dispará-la em NFs específicas (ex.: uma NF sem frete).

  const toggleAll = (v: boolean) => {
    const next: Record<string, boolean> = {};
    if (v) docs.forEach((document) => { next[document.id] = true; });
    setSelected(next);
  };

  // Deriva tomador a partir das NFs selecionadas
  const tomador = useMemo(() => {
    if (!selectedDocs.length) return null;
    return resolveNFSeTomador(selectedDocs[0],tomadorMode,clients);
  }, [selectedDocs, tomadorMode, clients]);

  // Sincroniza o manualTomador quando o tomador derivado muda e o usuário NÃO está editando manualmente
  useEffect(() => {
    if (!isEditingTomador && tomador) {
      setManualTomador((current) => (
        current && JSON.stringify(current) === JSON.stringify(tomador) ? current : tomador
      ));
    }
  }, [tomador, isEditingTomador]);

  const setManualField = <K extends keyof TomadorData>(key: K, value: TomadorData[K]) => {
    setIsEditingTomador(true);
    setManualTomador((current) => current ? { ...current, [key]: value } : current);
  };

  const allSameTomador = useMemo(() => {
    if (selectedDocs.length < 2) return true;
    const identities = selectedDocs.map((document) => normalizedPartyIdentity(resolveNFSeTomador(document, tomadorMode, clients)));
    return identities.every((identity) => identity === identities[0]);
  }, [selectedDocs, tomadorMode, clients]);

  const requiresEmissionMode = selectedDocs.length > 1;
  const effectiveEmissionMode: EmissionMode = batchAttempt?.mode ?? (requiresEmissionMode ? emissionMode ?? 'individual' : 'individual');
  const canAdvance = selectedDocs.length > 0
    && (!requiresEmissionMode || emissionMode !== null)
    && (effectiveEmissionMode === 'unified' ? allSameTomador : true);

  const handleEmit = async () => {
    if (batchAttempt) {
      setIssuing(true);
      try {
        const result = await issueBatch.mutateAsync({
          mode: batchAttempt.mode,
          requestId: batchAttempt.requestId,
          nfseDocumentIds: Object.values(batchAttempt.drafts).map(draft => draft.nfseDocumentId),
        });
        setBatchResult(result);
        if (result.success) {
          if (batchStorageKey) sessionStorage.removeItem(batchStorageKey);
          toast.success('Emissão de NFS-e concluída. Confira o resultado por nota.');
        }
        else toast.error('O lote teve resultados pendentes ou com falha. Revise cada nota antes de tentar novamente.');
      } catch (error: unknown) {
        toast.error(errorMessage(error));
      } finally {
        setIssuing(false);
      }
      return;
    }
    if (!emitterId) { toast.error('Selecione o emitente fiscal'); return; }
    
    setIssuing(true);
    try {
      let attempt: BatchAttempt = {
        mode: effectiveEmissionMode,
        requestId: crypto.randomUUID(),
        environment,
        sourceCount: selectedDocs.length,
        drafts: {},
      };
      const rememberDraft = (sourceKey: string, nfseDocumentId: string, label: string) => {
        attempt = {...attempt, drafts: {...attempt.drafts, [sourceKey]: {nfseDocumentId, label}}};
        setBatchAttempt(attempt);
      };

      if (effectiveEmissionMode === 'unified') {
        // Lógica original de agrupamento
        const currentTomador = manualTomador || tomador;
        if (!currentTomador?.cnpj) { throw new Error('Tomador sem CNPJ — cadastre o cliente/fornecedor'); }
        
        const fdIds = selectedDocs.map((document) => document.id);
        const description = (descricao?.trim() ||
          `Prestacao de servico de transporte referente a ${fdIds.length} NF(s): ` +
          selectedDocs.map((document) => `NF ${document.invoice_number || document.access_key?.slice(-9)}`).join(', '))
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const payload: Partial<NFSeDoc> = {
          emitter_id: emitterId,
          regime_tributario: regimeTributario,
          issue_date: issueDate,
          cliente_id: currentTomador.cliente_id,
          cliente_nome: currentTomador.nome,
          cliente_cnpj: currentTomador.cnpj,
          cliente_ie: currentTomador.ie || null,
          cliente_im: currentTomador.im || null,
          cliente_email: currentTomador.email || null,
          cliente_telefone: currentTomador.telefone || null,
          cliente_numero: currentTomador.numero || null,
          cliente_complemento: currentTomador.complemento || null,
          cliente_endereco: currentTomador.endereco,
          cliente_bairro: currentTomador.bairro,
          cliente_municipio: currentTomador.municipio,
          cliente_uf: currentTomador.uf,
          cliente_cep: normalizeCep(currentTomador.cep),
          cliente_cod_municipio: normalizeIbgeCity(currentTomador.municipio_cod) || normalizeIbgeCity(currentTomador.municipio),
          description,
          aliquota_iss: aliquotaIss,
          iss_retido: issRetido,
          cod_servico: codServico || undefined,
          cnae: cnae || undefined,
          nat_operacao: natOperacao || undefined,
          valor_servicos: totalServicos,
          base_calculo: baseCalculo,
          valor_iss: valorIss,
          valor_liquido: valorLiquido,
          valor_total: totalServicos,
          valor_deducoes: num(valorDeducoes),
          valor_pis: valorPis,
          valor_cofins: valorCofins,
          valor_inss: valorInss,
          valor_ir: valorIr,
          valor_csll: valorCsll,
          outras_retencoes: num(outrasRetencoes),
          insurer_name: insurerName.trim() || null,
          insurer_cnpj: insurerCnpj.replace(/\D/g, '') || null,
          insurer_policy: insurerPolicy.trim() || null,
          insurer_endorsement: insurerEndorsement.trim() || null,
          insured_amount: num(insuredAmount) || null,
          insurance_premium: num(insurancePremium) || null,
          items: selectedDocs.map((document) => ({
            description: `NF ${document.invoice_number || ''} — ${document.remitter || ''}`.trim(),
            quantity: 1,
            unit_value: valorPorDoc(document),
            total: valorPorDoc(document),
            fiscal_document_id: document.id,
            access_key: document.access_key,
          })),
          fiscal_document_ids: fdIds,
          notes: observacoes.trim() || undefined,
        };
        if (!attempt.drafts.unified) {
          const created = await create.mutateAsync(payload);
          rememberDraft('unified', created.id, selectedDocs.map(d => d.invoice_number || d.id).join(', '));
        }
      } else {
        // Emissão individual
        toast.info(`Iniciando emissão individual de ${selectedDocs.length} nota(s)...`);
        const allocationEntries = selectedDocs.map((document) => ({
          key: document.id,
          weight: valorPorDoc(document),
        }));
        const deductionShares = allocateCurrency(num(valorDeducoes), allocationEntries);
        const otherRetentionShares = allocateCurrency(num(outrasRetencoes), allocationEntries);
        const insuredAmountShares = allocateCurrency(num(insuredAmount), allocationEntries);
        const insurancePremiumShares = allocateCurrency(num(insurancePremium), allocationEntries);
        
        for (const d of selectedDocs) {
          if (attempt.drafts[d.id]) continue;
          const docTomador = selectedDocs.length===1 && manualTomador ? manualTomador : resolveNFSeTomador(d,tomadorMode,clients);
          if (!docTomador.cnpj) throw new Error('Tomador sem CNPJ/CPF na NF '+d.invoice_number);

          const docValue = valorPorDoc(d);
          const docDeductions = deductionShares[d.id];
          const docOtherRetentions = otherRetentionShares[d.id];
          const docBase = +(Math.max(0, docValue - docDeductions)).toFixed(2);
          const docIss = +(docBase * num(aliquotaIss) / 100).toFixed(2);
          const docRet = +(
            (issRetido ? docIss : 0) + 
            (docBase * num(aliqPis) / 100) + 
            (docBase * num(aliqCofins) / 100) + 
            (docBase * num(aliqInss) / 100) + 
            (docBase * num(aliqIr) / 100) + 
            (docBase * num(aliqCsll) / 100) + 
            docOtherRetentions
          ).toFixed(2);
          const docLiq = +(docValue - docDeductions - docRet).toFixed(2);

          const description = (descricao.trim() || `Prestacao de servico de transporte referente a NF ${d.invoice_number || d.access_key?.slice(-9)}`)
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

          const payload: Partial<NFSeDoc> = {
            emitter_id: emitterId,
            regime_tributario: regimeTributario,
            issue_date: issueDate,
            cliente_id: docTomador.cliente_id,
            cliente_nome: docTomador.nome,
            cliente_cnpj: docTomador.cnpj,
            cliente_ie: docTomador.ie || null,
            cliente_im: docTomador.im || null,
            cliente_email: docTomador.email || null,
            cliente_telefone: docTomador.telefone || null,
            cliente_numero: docTomador.numero || null,
            cliente_complemento: docTomador.complemento || null,
            cliente_endereco: docTomador.endereco,
            cliente_bairro: docTomador.bairro,
            cliente_municipio: docTomador.municipio,
            cliente_uf: docTomador.uf,
            cliente_cep: docTomador.cep,
            cliente_cod_municipio: docTomador.municipio_cod,
            description,
            aliquota_iss: aliquotaIss,
            iss_retido: issRetido,
            cod_servico: codServico || undefined,
            cnae: cnae || undefined,
            nat_operacao: natOperacao || undefined,
            valor_servicos: docValue,
            base_calculo: docBase,
            valor_iss: docIss,
            valor_liquido: docLiq,
            valor_total: docValue,
            valor_deducoes: docDeductions,
            valor_pis: +(docBase * num(aliqPis) / 100).toFixed(2),
            valor_cofins: +(docBase * num(aliqCofins) / 100).toFixed(2),
            valor_inss: +(docBase * num(aliqInss) / 100).toFixed(2),
            valor_ir: +(docBase * num(aliqIr) / 100).toFixed(2),
            valor_csll: +(docBase * num(aliqCsll) / 100).toFixed(2),
            outras_retencoes: docOtherRetentions,
            insurer_name: insurerName.trim() || null,
            insurer_cnpj: insurerCnpj.replace(/\D/g, '') || null,
            insurer_policy: insurerPolicy.trim() || null,
            insurer_endorsement: insurerEndorsement.trim() || null,
            insured_amount: insuredAmount > 0 ? insuredAmountShares[d.id] : null,
            insurance_premium: insurancePremium > 0 ? insurancePremiumShares[d.id] : null,
            items: [{
              description: `NF ${d.invoice_number || ''} — ${d.remitter || ''}`.trim(),
              quantity: 1,
              unit_value: docValue,
              total: docValue,
              fiscal_document_id: d.id,
              access_key: d.access_key,
            }],
            fiscal_document_ids: [d.id],
            notes: observacoes.trim() || undefined,
          };
          const created = await create.mutateAsync(payload);
          rememberDraft(d.id, created.id, d.invoice_number || d.access_key?.slice(-9) || d.id);
        }
      }
      const result = await issueBatch.mutateAsync({
        mode: attempt.mode,
        requestId: attempt.requestId,
        nfseDocumentIds: Object.values(attempt.drafts).map(draft => draft.nfseDocumentId),
      });
      setBatchResult(result);
      if (result.success) {
        if (batchStorageKey) sessionStorage.removeItem(batchStorageKey);
        toast.success('Emissão de NFS-e concluída. Confira o resultado por nota.');
      }
      else toast.error('O lote teve resultados pendentes ou com falha. Revise cada nota antes de tentar novamente.');
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Emitir NFS-e a partir de NFs {step === 1 ? '— 1. Selecionar notas' : step === 2 ? '— 2. Valores por NF' : '— 3. Dados fiscais e emissão'}
          </DialogTitle>
          <DialogDescription>
            Selecione as notas, revise os valores e informe os dados fiscais antes de emitir.
          </DialogDescription>
        </DialogHeader>

        <FiscalEnvironmentSelect value={environment} onChange={setEnvironment} disabled={issueBatch.isPending || create.isPending || !!batchAttempt} />

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-2">
                <Label>Fornecedor / Remetente</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL_NONE}>Todos</SelectItem>
                    {suppliers.map((client) => <SelectItem key={client.id} value={client.id}>{client.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Cliente / Destinatário</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL_NONE}>Todos</SelectItem>
                    {clientList.map((client) => <SelectItem key={client.id} value={client.id}>{client.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Cidade Destino</Label>
                <Input 
                  placeholder="Filtrar por cidade..." 
                  value={recipientCity} 
                  onChange={e => setRecipientCity(e.target.value)} 
                />
              </div>
              <div><Label>Nº NF</Label><Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
              <div><Label>Emissão de</Label><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></div>
              <div><Label>até</Label><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={showAllPending}>Mostrar todas as NFs não faturadas</Button>
              <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? 'Atualizando…' : 'Atualizar notas'}
              </Button>
            </div>
            {docsError && <div role="alert" className="text-sm text-destructive">
              Não foi possível consultar as NFs não faturadas. Clique em Atualizar notas para tentar novamente.
            </div>}
            <div className="text-xs text-muted-foreground">
              Somente NFs de entrada não faturadas com destino no município da transportadora. Destinos de outros municípios ficam na lista de CT-e.
            </div>

            <div className="rounded-md border max-h-[52vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Selecionar todas as NFs disponíveis"
                        checked={docs.length > 0 && selectedDocs.length === docs.length}
                        onCheckedChange={v => toggleAll(!!v)}
                      />
                    </TableHead>
                    <TableHead>NF</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead>Remetente</TableHead>
                    <TableHead>Destinatário</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Valor NF</TableHead>
                    <TableHead className="text-right">Frete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Carregando…</TableCell></TableRow>}
                  {!isLoading && !docsError && docs.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhuma NF disponível</TableCell></TableRow>
                  )}
                  {docs.map((d) => (
                    <TableRow key={d.id} className={selected[d.id] ? 'bg-muted/40' : ''}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Selecionar NF ${d.invoice_number || d.access_key?.slice(-9) || d.id}`}
                          checked={!!selected[d.id]}
                          onCheckedChange={v => setSelected(s => ({ ...s, [d.id]: !!v }))}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.invoice_number || d.access_key?.slice(-9) || '—'}</TableCell>
                      <TableCell className="text-xs">{d.issue_date}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{d.remitter || '—'}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{d.recipient || '—'}</TableCell>
                      <TableCell className="text-xs">{d.recipient_city ? `${d.recipient_city}${d.recipient_state ? `/${d.recipient_state}` : ''}` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {num(d.value).toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {num(d.freight_value).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {selectedDocs.length > 1 && emissionMode === 'unified' && !allSameTomador && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                As NFs selecionadas têm dados fiscais divergentes para o {tomadorMode === 'remetente' ? 'remetente' : 'destinatário'}.
                Para emitir uma única NFS-e, CNPJ/CPF, nome, inscrição e endereço do tomador precisam coincidir.
              </div>
            )}

            {selectedDocs.length > 1 && (
              <fieldset className="rounded-md border bg-muted/20 p-4" aria-describedby="nfse-emission-mode-help">
                <legend className="px-1 text-sm font-semibold">Como deseja emitir as NFS-e?</legend>
                <p id="nfse-emission-mode-help" className="mb-3 text-xs text-muted-foreground">
                  Esta escolha é obrigatória para múltiplas NFs e será aplicada antes de qualquer emissão.
                </p>
                <RadioGroup
                  value={emissionMode ?? ''}
                  onValueChange={(value) => setEmissionMode(value as EmissionMode)}
                  aria-label="Modo de emissão das NFS-e"
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <Label
                    htmlFor="nfse-emission-individual"
                    className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 font-normal has-[[data-state=checked]]:border-primary"
                  >
                    <RadioGroupItem id="nfse-emission-individual" value="individual" className="mt-0.5" />
                    <span>
                      <span className="block font-medium">Individual</span>
                      <span className="block text-xs text-muted-foreground">
                        Emitir uma NFS-e para cada NF selecionada, repetindo as mesmas regras tributárias informadas.
                      </span>
                    </span>
                  </Label>
                  <Label
                    htmlFor="nfse-emission-unified"
                    className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 font-normal has-[[data-state=checked]]:border-primary"
                  >
                    <RadioGroupItem id="nfse-emission-unified" value="unified" className="mt-0.5" />
                    <span>
                      <span className="block font-medium">Unificada</span>
                      <span className="block text-xs text-muted-foreground">
                        Emitir uma única NFS-e consolidando todas as NFs selecionadas e seus valores.
                      </span>
                    </span>
                  </Label>
                </RadioGroup>
                {emissionMode === null && (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    Selecione emissão individual ou unificada para continuar.
                  </p>
                )}
              </fieldset>
            )}

            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-sm">
                <Badge variant="secondary">{selectedDocs.length} NF(s)</Badge>{' '}
                <span className="text-muted-foreground">Total frete: </span>
                <span className="font-semibold tabular-nums">R$ {totalServicos.toFixed(2)}</span>
                {missingFreight > 0 && (
                  <span className="ml-2 text-xs text-yellow-600">
                    ({missingFreight} sem frete — recalcule pela tabela)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRecalc}
                  disabled={manualRecalcing || docs.length === 0}
                  title="Recalcula o frete de TODAS as NFs listadas usando a tabela de frete vigente"
                >
                  {manualRecalcing
                    ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    : <Calculator className="h-4 w-4 mr-1" />}
                  Recalcular frete
                </Button>
                <div className="flex items-center gap-2">
                  <Label htmlFor="nfse-tomador-mode" className="text-xs">Tomador é:</Label>
                  <Select value={tomadorMode} onValueChange={(value) => setTomadorMode(value as 'remetente' | 'destinatario')}>
                    <SelectTrigger id="nfse-tomador-mode" className="w-40 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="remetente">Remetente</SelectItem>
                      <SelectItem value="destinatario">Destinatário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => {
                    // Pré-preenche valor de serviço com o frete atual de cada NF selecionada
                    setServiceValues(prev => {
                      const next = { ...prev };
                      selectedDocs.forEach((d) => {
                        if (next[d.id] === undefined) {
                          next[d.id] = num(d.freight_value ?? d.value ?? 0);
                        }
                      });
                      return next;
                    });
                    setStep(2);
                    // Preenche observações automaticamente ao avançar
                    const nfList = selectedDocs.map((d) => d.invoice_number || d.access_key?.slice(-9)).join(', ');
                    setObservacoes(`NFS-e referente a(s) NF ${nfList}`);
                  }}
                  disabled={!canAdvance || isFetching || !!docsError}
                >
                  Avançar <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Ajuste, se necessário, o valor de serviço de cada NF selecionada. O valor vem pré-preenchido a partir do frete calculado automaticamente.
            </div>
            <div className="border rounded-md max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">NF</th>
                    <th className="text-left p-2">Remetente</th>
                    <th className="text-left p-2">Destinatário</th>
                    <th className="text-right p-2">Frete calc.</th>
                    <th className="text-right p-2 w-40">Vl. Serviço (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDocs.map((d) => {
                    const freteCalc = num(d.freight_value ?? 0);
                    const val = serviceValues[d.id] ?? freteCalc;
                    return (
                      <tr key={d.id} className="border-t">
                        <td className="p-2 font-mono">{d.invoice_number || d.access_key?.slice(-9)}</td>
                        <td className="p-2">{d.remitter || '—'}</td>
                        <td className="p-2">{d.recipient || '—'}</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">R$ {freteCalc.toFixed(2)}</td>
                        <td className="p-2 text-right">
                          <Input
                            aria-label={`Valor do serviço da NF ${d.invoice_number || d.access_key?.slice(-9) || d.id}`}
                            type="number"
                            step="0.01"
                            className="h-8 text-right"
                            value={val}
                            onChange={e => setServiceValues(prev => ({ ...prev, [d.id]: +e.target.value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 border-t">
                    <td colSpan={3} className="p-2 text-right font-semibold">Total serviços</td>
                    <td className="p-2"></td>
                    <td className="p-2 text-right font-semibold tabular-nums">R$ {totalServicos.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4" aria-label="Resumo da emissão">
              <div className="text-sm font-semibold">Resumo da emissão</div>
              <div className="mt-1 text-sm">
                {effectiveEmissionMode === 'unified'
                  ? `1 NFS-e unificada para ${selectedDocs.length || batchAttempt?.sourceCount || 0} NFs selecionadas.`
                  : `${selectedDocs.length || batchAttempt?.sourceCount || Object.keys(batchAttempt?.drafts || {}).length} NFS-e, uma para cada NF selecionada.`}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedDocs.length > 0
                  ? `Valor total dos serviços: R$ ${totalServicos.toFixed(2)}. Revise os dados abaixo antes de confirmar.`
                  : 'Comando recuperado desta sessão. Os mesmos rascunhos e identificador serão reutilizados com segurança.'}
              </div>
            </div>
            {batchAttempt && !batchResult && (
              <div role="status" className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                Os rascunhos deste comando foram preservados. Se o envio falhar ou ficar incerto, tente novamente pelo botão abaixo;
                nenhuma NFS-e já preparada será recriada.
              </div>
            )}
            {batchResult && (
              <div className="rounded-md border p-4" aria-label="Resultado da emissão por NF">
                <div className="font-semibold">Resultado por NF</div>
                <div className="mt-3 space-y-2">
                  {batchResult.results.map((result) => {
                    const draft = Object.values(batchAttempt?.drafts || {}).find(item => item.nfseDocumentId === result.nfseDocumentId);
                    const uncertain = !result.success && (result.status === 0 || result.status >= 500);
                    return (
                      <div key={result.nfseDocumentId} className="flex items-start justify-between gap-3 rounded border p-3 text-sm">
                        <div>
                          <div className="font-medium">{draft?.label || result.nfseDocumentId}</div>
                          {result.error?.message && <div className="mt-1 text-xs text-muted-foreground">{result.error.message}</div>}
                        </div>
                        <Badge variant={result.success ? 'secondary' : 'destructive'}>
                          {result.success ? 'Processada' : uncertain ? 'Conciliação necessária' : 'Falhou'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
                {!batchResult.success && (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    Não há rollback automático. Antes de reenviar, confira os itens marcados para conciliação; a nova tentativa reutiliza o mesmo comando e os mesmos rascunhos.
                  </p>
                )}
              </div>
            )}
            <div className="rounded-md border bg-muted/30 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="font-semibold flex items-center gap-2">
                    Tomador do serviço
                    {isEditingTomador && <Badge variant="outline" className="text-[10px] h-4">Editado</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Baseado em {selectedDocs.length} NF(s) — total R$ {totalServicos.toFixed(2)}
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-xs" 
                  onClick={() => setIsEditingTomador(!isEditingTomador)}
                >
                  {isEditingTomador ? 'Visualizar Resumo' : 'Editar Dados'}
                </Button>
              </div>

              {!isEditingTomador ? (
                <div className="text-sm space-y-1">
                  <div className="font-medium">{manualTomador?.nome || tomador?.nome} — CNPJ {manualTomador?.cnpj || tomador?.cnpj}</div>
                  {(manualTomador?.endereco || tomador?.endereco) && (
                    <div className="text-muted-foreground text-xs">
                      {manualTomador?.endereco || tomador?.endereco}, {manualTomador?.numero || tomador?.numero} — {manualTomador?.bairro || tomador?.bairro}
                      <br />
                      {manualTomador?.municipio || tomador?.municipio}/{manualTomador?.uf || tomador?.uf} — CEP {manualTomador?.cep || tomador?.cep}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-6 gap-3 pt-2">
                  <div className="col-span-4">
                    <Label className="text-[10px] uppercase">Razão Social / Nome</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.nome || ''} onChange={e => setManualField('nome', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase">CNPJ / CPF</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.cnpj || ''} onChange={e => setManualField('cnpj', e.target.value)} />
                  </div>
                  <div className="col-span-4">
                    <Label className="text-[10px] uppercase">Endereço (Logradouro)</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.endereco || ''} onChange={e => setManualField('endereco', e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase">Número</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.numero || ''} onChange={e => setManualField('numero', e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase">UF</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.uf || ''} maxLength={2} onChange={e => setManualField('uf', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase">Bairro</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.bairro || ''} onChange={e => setManualField('bairro', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase">Cidade</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.municipio || ''} onChange={e => setManualField('municipio', e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase">CEP</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.cep || ''} maxLength={9} onChange={e => setManualField('cep', e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase">Cód. IBGE</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.municipio_cod || ''} maxLength={7} onChange={e => setManualField('municipio_cod', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase">Inscrição Estadual</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.ie || ''} onChange={e => setManualField('ie', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase">E-mail</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.email || ''} onChange={e => setManualField('email', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase">Telefone</Label>
                    <Input className="h-8 text-xs" value={manualTomador?.telefone || ''} onChange={e => setManualField('telefone', e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-3">
                <Label>Emitente Fiscal</Label>
                <Select value={emitterId} onValueChange={setEmitterId}>
                  <SelectTrigger><SelectValue placeholder={emitters.length ? 'Selecione' : 'Cadastre em Configurações'} /></SelectTrigger>
                  <SelectContent>
                    {emitters.filter(e => e.active).map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.razao_social} — CNPJ {e.cnpj}{e.is_default ? ' (padrão)' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Regime Tributário</Label>
                <Select value={regimeTributario} onValueChange={setRegimeTributario}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Simples Nacional</SelectItem>
                    <SelectItem value="3">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Data emissão</Label><Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
              <div><Label>Alíquota ISS (%)</Label><Input type="number" step="0.0001" value={aliquotaIss} onChange={e => setAliquotaIss(+e.target.value)} /></div>
              <div className="flex items-end gap-2"><Checkbox checked={issRetido} onCheckedChange={v => setIssRetido(!!v)} /><Label>ISS Retido</Label></div>

              <div className="col-span-2"><Label>Cód. Serviço</Label><Input value={codServico} onChange={e => setCodServico(e.target.value)} /></div>
              <div className="col-span-2"><Label>CNAE</Label><Input value={cnae} onChange={e => setCnae(e.target.value)} /></div>
              <div className="col-span-2"><Label>Nat. Operação</Label><Input value={natOperacao} onChange={e => setNatOperacao(e.target.value)} /></div>

              <div className="col-span-6">
                <Label>Discriminação dos Serviços</Label>
                <Textarea rows={4} value={descricao} onChange={e => setDescricao(e.target.value)}
                  placeholder={`Prestação de serviço de transporte referente a ${selectedDocs.length} NF(s)…`} />
              </div>
              <div className="col-span-6">
                <Label>Observações / Notas</Label>
                <Textarea 
                  rows={2} 
                  value={observacoes} 
                  onChange={e => setObservacoes(e.target.value)}
                  placeholder="Observações que constarão na nota…"
                />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground">Retenções e deduções (opcionais)</div>
              <div className="grid grid-cols-6 gap-3">
                <div>
                  <Label className="text-xs">Deduções (R$)</Label>
                  <Input type="number" step="0.01" value={valorDeducoes} onChange={e => setValorDeducoes(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">PIS (%)</Label>
                  <Input type="number" step="0.0001" value={aliqPis} onChange={e => setAliqPis(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">COFINS (%)</Label>
                  <Input type="number" step="0.0001" value={aliqCofins} onChange={e => setAliqCofins(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">INSS (%)</Label>
                  <Input type="number" step="0.0001" value={aliqInss} onChange={e => setAliqInss(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">IR (%)</Label>
                  <Input type="number" step="0.0001" value={aliqIr} onChange={e => setAliqIr(+e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">CSLL (%)</Label>
                  <Input type="number" step="0.0001" value={aliqCsll} onChange={e => setAliqCsll(+e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Outras retenções (R$)</Label>
                  <Input type="number" step="0.01" value={outrasRetencoes} onChange={e => setOutrasRetencoes(+e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-6 gap-3 pt-2 border-t text-xs">
                <div><div className="text-muted-foreground">PIS</div><div className="font-medium tabular-nums">R$ {valorPis.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">COFINS</div><div className="font-medium tabular-nums">R$ {valorCofins.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">INSS</div><div className="font-medium tabular-nums">R$ {valorInss.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">IR</div><div className="font-medium tabular-nums">R$ {valorIr.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">CSLL</div><div className="font-medium tabular-nums">R$ {valorCsll.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">Retenções (total)</div><div className="font-semibold tabular-nums">R$ {totalRetencoes.toFixed(2)}</div></div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground">
                Seguro da carga (impresso na discriminação da NFS-e)
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Seguradora</Label>
                  <Input value={insurerName} onChange={e => setInsurerName(e.target.value)} />
                  {insuranceCheck.errors.name && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.name}</p>}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">CNPJ da seguradora</Label>
                  <Input value={insurerCnpj} onChange={e => setInsurerCnpj(formatCnpj(e.target.value))} placeholder="00.000.000/0000-00" />
                  {insuranceCheck.errors.cnpj && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.cnpj}</p>}
                </div>
                <div>
                  <Label className="text-xs">Apólice</Label>
                  <Input value={insurerPolicy} onChange={e => setInsurerPolicy(e.target.value)} />
                  {insuranceCheck.errors.policy && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.policy}</p>}
                </div>
                <div>
                  <Label className="text-xs">Averbação</Label>
                  <Input value={insurerEndorsement} onChange={e => setInsurerEndorsement(e.target.value)} />
                  {insuranceCheck.errors.endorsement && <p className="text-xs text-destructive mt-1">{insuranceCheck.errors.endorsement}</p>}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Valor segurado (R$)</Label>
                  <Input type="number" step="0.01" value={insuredAmount} onChange={e => setInsuredAmount(+e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Prêmio do seguro (R$)</Label>
                  <Input type="number" step="0.01" value={insurancePremium} onChange={e => setInsurancePremium(+e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={saveInsuranceProfile.isPending || !insurerName}
                  onClick={async () => {
                    try {
                      await saveInsuranceProfile.mutateAsync({
                        name: insurerName,
                        cnpj: insurerCnpj.replace(/\D/g, ''),
                        policy: insurerPolicy,
                      });
                      toast.success('Seguradora salva como padrão');
                    } catch (error: unknown) {
                      toast.error('Falha ao salvar seguradora', { description: errorMessage(error) });
                    }
                  }}
                >
                  <Save className="h-3 w-3 mr-1" />
                  Salvar como padrão
                </Button>
                {hasInsuranceProfile(insuranceProfile) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={() => {
                      setInsurerName(insuranceProfile?.name || '');
                      setInsurerCnpj(formatCnpj(insuranceProfile?.cnpj || ''));
                      setInsurerPolicy(insuranceProfile?.policy || '');
                      setInsurerEndorsement(insuranceProfile?.cnpj || ''); // Padrão: averbação = CNPJ
                      toast.success('Seguradora padrão aplicada');
                    }}
                  >
                    Usar padrão salvo
                  </Button>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  Seguradora, CNPJ e apólice são compartilhados entre CT-e e NFS-e.
                </span>
              </div>
            </div>

            {totalServicos <= 0 && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-800">
                Valor de serviços está zerado. Volte ao passo 1 e clique em <strong>Recalcular frete</strong> para calcular
                a partir da tabela de frete das NFs selecionadas.
              </div>
            )}

            <div className="rounded-md border p-3 grid grid-cols-4 gap-3 bg-muted/30">
              <div><div className="text-xs text-muted-foreground">Vl. Serviços</div><div className="font-semibold tabular-nums">R$ {totalServicos.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Base Cálculo</div><div className="font-semibold tabular-nums">R$ {baseCalculo.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Vl. ISS</div><div className="font-semibold tabular-nums">R$ {valorIss.toFixed(2)}</div></div>
              <div><div className="text-xs text-muted-foreground">Vl. Líquido</div><div className="font-semibold tabular-nums">R$ {valorLiquido.toFixed(2)}</div></div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((step - 1) as 1 | 2)} disabled={issuing || !!batchAttempt}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={issuing}>Cancelar</Button>
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={totalServicos <= 0}>
              Avançar <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 3 && (
            batchResult?.success ? (
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            ) : (
              <Button onClick={handleEmit} disabled={issuing || create.isPending || issueBatch.isPending || isFetching || !!docsError}>
                {issuing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                {batchAttempt ? 'Tentar novamente com segurança' : 'Emitir NFS-e'}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
