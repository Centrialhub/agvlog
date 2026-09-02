import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseNFeXml, parseCsvOrders, parseExcelOrders, ParsedOrderRow, ParsedNFe } from '@/lib/documentParsers';
import {
  validateNFe, validateOrderRows, buildValidationIndexes,
  ValidatedDocument, ValidatedOrder, LoadSuggestion,
} from '@/lib/ingestionValidator';
import { useFiscalDocuments, useCreateFiscalDocument } from '@/hooks/useFiscalDocuments';
import { useClients } from '@/hooks/useClients';
import { useCreateOrder } from '@/hooks/useOrders';
import { useCreateLoad, useLoads } from '@/hooks/useLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { useOperationalRoutes, useUpdateOperationalRoute } from '@/hooks/useOperationalRoutes';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, FileStack } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';
import IngestionStepper from '@/components/ingestion/IngestionStepper';
import UploadStep from '@/components/ingestion/UploadStep';
import ORTReviewStep from '@/components/ingestion/ORTReviewStep';
import ValidationStep from '@/components/ingestion/ValidationStep';
import RoutingStep from '@/components/ingestion/RoutingStep';
import type { RouteGroup } from '@/components/ingestion/RoutingStep';
import GroupingStep from '@/components/ingestion/GroupingStep';
import ResultsStep from '@/components/ingestion/ResultsStep';
import { calculateFreight, logFreightCalculation } from '@/hooks/useFreightCalculator';
import type { FreightBreakdown } from '@/hooks/useFreightCalculator';
import { applyOrtFallbacks } from '@/lib/ortFieldFallbacks';
import { normalizeStateRegistration, normalizeIeIndicator, FISCAL_UNKNOWN } from '@/lib/fiscalNormalization';
import { detectPaymentMethodDetailed } from '@/lib/paymentMethodDetection';
import PickupOrderPicker from '@/components/pickup/PickupOrderPicker';
import type { PickupOrder } from '@/hooks/usePickupOrders';
import type { IngestionReport, OrtAuditEntry, OrtReviewDocument, OrtReviewItem } from '@/lib/ingestion/types';
import {
  buildOrtAccessKey,
  dedupeOrtReviewDocs,
  fileToBase64,
  getChangedOrtFields,
  mapOrtItems,
  toOrtAuditPayload,
} from '@/lib/ingestion/ortUtils';
import { buildIngestionReport, createIngestionBatchId } from '@/lib/ingestion/report';
import { normalizeNfeAccessKey } from '@/lib/fiscalDocuments/nfeAccessKey';

import { supabase } from '@/integrations/supabase/client';
import type { Json, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/hooks/useTenant';
import { useDrivers as useOperatorDrivers } from '@/hooks/useDrivers';
import { useTenantCapabilities } from '@/hooks/useTenantCapabilities';
import { useAuth } from '@/hooks/useAuth';
import { useItemPreparationWrites } from '@/hooks/useItemPreparationWrites';
import { prepareOrderItems } from '@/lib/ingestion/prepareOrderItems';
import type { RouteDestination } from '@/hooks/useOperationalRoutes';

type PersistedValidatedDocument = ValidatedDocument & { _savedId?: string };

interface EdgeFunctionErrorLike {
  message?: unknown;
  context?: {
    clone?: () => { json: () => Promise<unknown> };
    json?: () => Promise<unknown>;
  };
}

interface OrtExtractionDocument extends Partial<Omit<OrtReviewDocument, 'documentKind' | 'fileName' | 'items'>> {
  documentKind?: string;
  sourceFileName?: string;
  items?: Array<Partial<OrtReviewItem>>;
}

interface OrtExtractionResponse {
  error?: string;
  documents?: OrtExtractionDocument[];
}

interface SsxInsertPersonResponse {
  error?: unknown;
}

interface IngestionFileBuffer {
  file: File;
  name: string;
  kind: 'xml' | 'csv' | 'excel' | 'unknown' | 'error';
  text: string;
  buffer: ArrayBuffer | null;
  error?: string;
}

function getErrorMessage(error: unknown, fallback = 'Erro inesperado'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getResponseMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const candidate = body as { error?: unknown; message?: unknown };
  if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error;
  if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  return null;
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function getJsonNumber(value: Json, key: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value[key];
  const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function createInvalidParsedNFe(): ParsedNFe {
  return {
    invoiceNumber: '', series: '', model: '', accessKey: '', issueDate: '',
    emitterName: '', emitterCnpj: '', recipientName: '', recipientCnpj: '',
    recipientFantasyName: '', recipientStateRegistration: '', recipientMunicipalRegistration: '',
    recipientIeIndicator: '', recipientPhone: '', recipientEmail: '', recipientCity: '',
    recipientCityCode: '', recipientState: '', recipientAddress: '', recipientAddressNumber: '',
    recipientAddressComplement: '', recipientNeighborhood: '', recipientZip: '', recipientCountry: '',
    recipientCountryCode: '', items: [], totalValue: 0, totalWeight: 0, totalVolume: 0,
    estimatedPallets: 0, clientLoadNumber: '', observation: '',
  };
}

function getPersistedDocumentId(doc: ValidatedDocument): string | undefined {
  return (doc as PersistedValidatedDocument)._savedId;
}

function useDrivers() {
  return useOperatorDrivers();
}

async function getEdgeFunctionErrorMessage(error: unknown): Promise<string> {
  const candidate = error && typeof error === 'object' ? error as EdgeFunctionErrorLike : {};
  const fallback = typeof candidate.message === 'string' && candidate.message
    ? candidate.message
    : 'Erro ao chamar a função de extração da ORT.';
  const context = candidate.context;

  try {
    if (context && typeof context.clone === 'function') {
      const cloned = context.clone();
      const body = await cloned.json().catch((): null => null);
      const message = getResponseMessage(body);
      if (message) return message;
    }
    if (context && typeof context.json === 'function') {
      const body = await context.json().catch((): null => null);
      const message = getResponseMessage(body);
      if (message) return message;
    }
  } catch {
    // Keep the original Supabase message when the response body is unavailable.
  }

  if (/non-2xx/i.test(fallback)) {
    return 'A extração da ORT retornou erro no servidor, mas sem detalhe legível. Tente novamente e, se persistir, verifique os créditos/limites da IA do workspace.';
  }

  return fallback;
}

export default function Ingestion() {
  const { data: existingDocs = [] } = useFiscalDocuments();
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const { data: drivers = [] } = useDrivers();
  const { data: loads = [] } = useLoads();
  const { data: operationalRoutes = [] } = useOperationalRoutes();
  const { currentTenant } = useTenant();
  const { isEnabled } = useTenantCapabilities();
  const ssxEnabled = isEnabled('ssx');
  const { user } = useAuth();
  const createDoc = useCreateFiscalDocument();
  const createOrder = useCreateOrder();
  const createLoad = useCreateLoad();
  const itemPreparations = useItemPreparationWrites();
  const updateRoute = useUpdateOperationalRoute();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Learn city → persist to operational_routes destinations
  const handleLearnCity = useCallback((routeId: string, cityName: string) => {
    const route = operationalRoutes.find(r => r.id === routeId);
    if (!route) return;
    const currentDests: RouteDestination[] = Array.isArray(route.destinations) ? route.destinations : [];
    const normalizedNew = cityName.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const alreadyExists = currentDests.some((d) => {
      const name = typeof d === 'string' ? d : d.name || '';
      return name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() === normalizedNew;
    });
    if (alreadyExists) return;
    const newDests = [...currentDests, { name: cityName }];
    updateRoute.mutate({ id: routeId, destinations: newDests });
    toast({ title: 'Rota atualizada', description: `"${cityName}" adicionada à rota. Próxima vez será automático.` });
  }, [operationalRoutes, updateRoute, toast]);

  const [step, setStep] = useState(0);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [validatedDocs, setValidatedDocs] = useState<PersistedValidatedDocument[]>([]);
  const [validatedOrders, setValidatedOrders] = useState<ValidatedOrder[]>([]);
  const [ortReviewDocs, setOrtReviewDocs] = useState<OrtReviewDocument[]>([]);
  const [suggestions, setSuggestions] = useState<LoadSuggestion[]>([]);
  const [executing, setExecuting] = useState(false);
  const [savingDocsOnly, setSavingDocsOnly] = useState(false);
  const [ortProcessing, setOrtProcessing] = useState(false);
  const [executionResults, setExecutionResults] = useState<string[]>([]);
  const [ingestionReport, setIngestionReport] = useState<IngestionReport | null>(null);
  const [ortClientIds, setOrtClientIds] = useState<Array<string | null>>([]);
  const [pickupOrderId, setPickupOrderId] = useState<string | null>(null);
  const [pickupOrder, setPickupOrder] = useState<PickupOrder | null>(null);
  const [noPickup, setNoPickup] = useState(false);
  const [syncSsxClients, setSyncSsxClients] = useState(false);

  // Reprocess flag: when set via ?reprocess=BATCH_ID query param, the page acts
  // as a re-run of an existing ingestion batch. Deduplication against existing
  // fiscal_documents (by access_key / invoice_number) is already enforced by the
  // validator and ORT dedupe — so re-uploading the same files will NOT create
  // duplicates. Only new docs are persisted; the resulting report is tagged
  // with "Reprocessamento de <batch_id>" for audit traceability.
  const [searchParams, setSearchParams] = useSearchParams();
  const reprocessBatchId = searchParams.get('reprocess');
  const reprocessSuffix = reprocessBatchId ? ` · Reprocessamento de ${reprocessBatchId}` : '';

  const getValidatedDocKey = (doc: ValidatedDocument) =>
    doc.source.accessKey || `${doc.source.emitterCnpj || ''}::${doc.source.model || '55'}::${doc.source.series || ''}::${doc.source.invoiceNumber}`;

  // Configurable confidence threshold for needsReview (calibrates OCR/extraction quality).
  const REVIEW_THRESHOLD_KEY = 'ingestion.reviewThreshold';
  const [reviewThreshold, setReviewThreshold] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(REVIEW_THRESHOLD_KEY));
      if (Number.isFinite(v) && v > 0 && v <= 1) return v;
    } catch {
      // Usa o limite padrão quando o storage local está indisponível ou inválido.
    }
    return 0.82;
  });
  const updateReviewThreshold = useCallback((v: number) => {
    const clamped = Math.max(0.5, Math.min(0.99, Number(v) || 0.82));
    setReviewThreshold(clamped);
    try { localStorage.setItem(REVIEW_THRESHOLD_KEY, String(clamped)); } catch {
      // A preferência permanece válida nesta sessão mesmo sem persistência local.
    }
  }, []);

  // Conta SSX ativa do tenant (1ª disponível) para sincronizar clientes recém-criados
  const { data: ssxAccountForClients } = useQuery({
    queryKey: ['ssx_account_for_client_sync', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data } = await supabase
        .from('integration_accounts')
        .select('id, username, status')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'ok')
        .limit(1)
        .maybeSingle();
      return data || null;
    },
    enabled: !!currentTenant && ssxEnabled,
  });

  const onlyDigits = (s: string | null | undefined) => String(s || '').replace(/\D/g, '');

  // Persists the report snapshot to ingestion_reports for historical browsing.
  const persistIngestionReport = useCallback(async (report: IngestionReport, sourceLabel: string) => {
    if (!currentTenant || report.totalDocs === 0) return;
    const batchId = report.auditMeta?.batchId
      || createIngestionBatchId();
    try {
      const payload: TablesInsert<'ingestion_reports'> = {
        tenant_id: currentTenant.id,
        batch_id: batchId,
        source_label: sourceLabel,
        total_docs: report.totalDocs,
        saved_docs: report.savedDocs,
        error_docs: report.errorDocs,
        needs_review_docs: report.needsReviewDocs,
        clients_auto_created: report.clientsAutoCreated,
        clients_matched: report.clientsMatched,
        clients_unresolved: report.clientsUnresolved,
        field_coverage: toJson(report.fieldCoverage),
        review_items: toJson(report.reviewItems || []),
        report: toJson(report),
        created_by: user?.id || null,
      };
      await supabase.from('ingestion_reports').insert(payload);
    } catch (e) {
      console.error('persistIngestionReport failed', e);
    }
  }, [currentTenant, user?.id]);

  const remitterMismatchDocs = useMemo(() => {
    if (!pickupOrder || noPickup) return [] as ValidatedDocument[];
    const expectedCnpj = onlyDigits(pickupOrder.remitter_cnpj);
    const expectedName = (pickupOrder.remitter_name || '').trim().toLowerCase();
    return validatedDocs.filter(d => {
      const docCnpj = onlyDigits(d.source.emitterCnpj);
      const docName = (d.source.emitterName || '').trim().toLowerCase();
      if (expectedCnpj && docCnpj) return docCnpj !== expectedCnpj;
      if (expectedName && docName) return !docName.includes(expectedName) && !expectedName.includes(docName);
      return false;
    });
  }, [validatedDocs, pickupOrder, noPickup]);

  const recordOrtAudit = async (doc: ValidatedDocument, fiscalDocumentId: string | null, status = 'saved') => {
    if (!currentTenant || !user || doc.source.series !== 'ORT') return;
    const ort = ortReviewDocs.find((candidate, idx) => {
      const identity = candidate.documentKind === 'nfe'
        ? normalizeNfeAccessKey(candidate.accessKey)
        : buildOrtAccessKey(candidate, `DOC${idx + 1}`);
      return identity === (doc.source.referenceNumber || doc.source.accessKey);
    });
    if (!ort) return;
    const payload: TablesInsert<'ort_extraction_audits'> = {
      tenant_id: currentTenant.id,
      fiscal_document_id: fiscalDocumentId,
      source_file_name: ort.fileName,
      ort_number: ort.invoiceNumber || null,
      dedupe_key: doc.source.accessKey,
      extracted_payload: toJson(ort.extractedPayload || toOrtAuditPayload(ort)),
      reviewed_payload: toJson(toOrtAuditPayload(ort)),
      field_confidences: toJson(ort.fieldConfidences || {}),
      overall_confidence: Math.max(0, Math.min(1, Number(ort.confidence) || 0)),
      needs_review: Boolean(ort.needsReview) || Number(ort.confidence) < reviewThreshold,
      reviewed: true,
      changed_fields: getChangedOrtFields(ort),
      status,
      created_by: user.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('ort_extraction_audits').insert(payload);
    if (error) throw error;
  };

  const handleFiles = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList);
    const t0 = performance.now();

    // Read ALL files in parallel (I/O bound) — huge speedup vs sequential await
    const fileBuffers = await Promise.all(
      files.map(async (file): Promise<IngestionFileBuffer> => {
        const name = file.name.toLowerCase();
        try {
          if (name.endsWith('.xml') || name.endsWith('.csv') || name.endsWith('.txt')) {
            return { file, name, kind: name.endsWith('.xml') ? 'xml' : 'csv', text: await file.text(), buffer: null as ArrayBuffer | null };
          }
          if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            return { file, name, kind: 'excel' as const, text: '', buffer: await file.arrayBuffer() };
          }
          return { file, name, kind: 'unknown' as const, text: '', buffer: null };
        } catch (e: unknown) {
          return { file, name, kind: 'error' as const, text: '', buffer: null, error: getErrorMessage(e, 'Erro de leitura') };
        }
      })
    );

    // Build validation indexes ONCE (O(N+M) lookups instead of O(N*M))
    const indexes = buildValidationIndexes(existingDocs, clients);

    // Build a Map for client lookup once (used inside validateNFe via clients array — already O(n) per doc, so we keep clients but skip rebuilds)
    const docs: ValidatedDocument[] = [];
    const orderRows: ParsedOrderRow[] = [];

    // Parse + validate (CPU bound, but sync and fast). Yield to UI between large batches.
    const BATCH = 50;
    for (let i = 0; i < fileBuffers.length; i++) {
      const fb = fileBuffers[i];
      if (fb.kind === 'xml') {
        try {
          const parsed = parseNFeXml(fb.text);
          const validated = validateNFe(parsed, fb.file.name, existingDocs, clients, indexes);
          
          // Re-validate specifically for multi-branch branch congruence if multiple CNPJ matches exist
          const cnpj = (parsed.recipientCnpj || '').replace(/\D/g, '');
          if (cnpj) {
            const matches = clients.filter(c => (c.tax_id || '').replace(/\D/g, '') === cnpj);
            if (matches.length > 1) {
              const city = (parsed.recipientCity || '').toUpperCase().trim();
              const branchMatch = matches.find(c => (c.address_city || '').toUpperCase().trim() === city);
              if (branchMatch) {
                validated.matchedClientId = branchMatch.id;
                validated.matchedClientName = branchMatch.company_name;
              }
            }
          }
          
          docs.push(validated);
        } catch (e: unknown) {
          docs.push({
            source: createInvalidParsedNFe(),
            fileName: fb.file.name,
            validations: [{ field: 'parse', message: `Erro ao ler XML: ${getErrorMessage(e)}`, severity: 'error' }],
            hasErrors: true, hasWarnings: false,
            matchedClientId: null, matchedClientName: null, isDuplicate: false,
          });
        }
      } else if (fb.kind === 'excel' && fb.buffer) {
        orderRows.push(...parseExcelOrders(fb.buffer));
      } else if (fb.kind === 'csv') {
        orderRows.push(...parseCsvOrders(fb.text));
      } else if (fb.kind === 'error') {
        docs.push({
          source: createInvalidParsedNFe(),
          fileName: fb.file.name,
          validations: [{ field: 'parse', message: `Erro ao ler arquivo: ${fb.error}`, severity: 'error' }],
          hasErrors: true, hasWarnings: false,
          matchedClientId: null, matchedClientName: null, isDuplicate: false,
        });
      }
      // Yield to event loop every BATCH to keep UI responsive on huge uploads
      if (i > 0 && i % BATCH === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    setValidatedDocs(docs);
    setValidatedOrders(validateOrderRows(orderRows, clients));
    const elapsed = Math.round(performance.now() - t0);
    console.log(`[Ingestion] processed ${files.length} files in ${elapsed}ms`);
    setStep(2);
  }, [existingDocs, clients]);

  const handleOrtFiles = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList);
    // Limite razoável: PDFs muito grandes estouram o AI Gateway.
    const MAX_PER_FILE = 3 * 1024 * 1024; // 3 MB por arquivo (recomendação Gemini inline)
    const oversized = files.find(f => f.size > MAX_PER_FILE);
    if (oversized) {
      toast({
        title: 'Arquivo muito grande',
        description: `"${oversized.name}" tem ${(oversized.size / 1024 / 1024).toFixed(1)} MB. Reduza a resolução do scan ou envie páginas separadas (máx. 3 MB por arquivo).`,
        variant: 'destructive',
      });
      return;
    }
    setOrtProcessing(true);
    try {
      const payload = await Promise.all(files.map(async file => ({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      })));

      const { data, error } = await supabase.functions.invoke<OrtExtractionResponse>('extract-ort', {
        body: { files: payload, tenantId: currentTenant?.id },
      });
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error));
      if (data?.error) throw new Error(data.error);

      const docs: OrtReviewDocument[] = (data?.documents || []).map((ort, idx) => {
        const reviewDoc: OrtReviewDocument = {
          documentKind: ort.documentKind === 'nfe' ? 'nfe' : 'ort',
          accessKey: normalizeNfeAccessKey(ort.accessKey),
          invoiceNumber: ort.invoiceNumber || '',
          issueDate: ort.issueDate || '',
          paymentTerms: ort.paymentTerms || '',
          billing: ort.billing || '',
          cargoDescription: ort.cargoDescription || '',
          emitterName: ort.emitterName || '',
          emitterCnpj: ort.emitterCnpj || '',
          recipientName: ort.recipientName || '',
          recipientCnpj: ort.recipientCnpj || '',
          recipientPhone: ort.recipientPhone || '',
          recipientCity: ort.recipientCity || '',
          recipientState: ort.recipientState || '',
          recipientAddress: ort.recipientAddress || '',
          recipientAddressNumber: ort.recipientAddressNumber || '',
          recipientZip: ort.recipientZip || '',
          recipientNeighborhood: ort.recipientNeighborhood || '',
          recipientFantasyName: ort.recipientFantasyName || '',
          recipientStateRegistration: ort.recipientStateRegistration || '',
          recipientMunicipalRegistration: ort.recipientMunicipalRegistration || '',
          recipientIeIndicator: ort.recipientIeIndicator || '',
          recipientEmail: ort.recipientEmail || '',
          recipientAddressComplement: ort.recipientAddressComplement || '',
          recipientCountry: ort.recipientCountry || '',
          recipientCountryCode: ort.recipientCountryCode || '',
          recipientCityCode: ort.recipientCityCode || '',
          totalValue: Number(ort.totalValue) || 0,
          totalWeight: Number(ort.totalWeight) || 0,
          totalVolume: Number(ort.totalVolume) || 0,
          estimatedPallets: Number(ort.estimatedPallets) || 0,
          productSummary: ort.productSummary || '',
          items: Array.isArray(ort.items) ? ort.items.map((item) => ({
            description: item.description || '',
            quantity: Number(item.quantity) || 0,
            unit: item.unit || '',
            unitPrice: Number(item.unitPrice) || 0,
            totalPrice: Number(item.totalPrice) || 0,
            weightKg: Number(item.weightKg) || 0,
            volumeM3: Number(item.volumeM3) || 0,
            confidence: Number(item.confidence) || Number(ort.confidence) || 0,
          })).filter((item) => item.description) : [],
          confidence: Number(ort.confidence) || 0,
          needsReview: Boolean(ort.needsReview) || Number(ort.confidence) < reviewThreshold,
          fieldConfidences: ort.fieldConfidences || {},
          fileName: ort.sourceFileName || files[idx]?.name || `Scan ${idx + 1}`,
          sourcePages: Array.isArray(ort.sourcePages) && ort.sourcePages.length
            ? ort.sourcePages
            : [ort.sourceFileName || files[idx]?.name || `Scan ${idx + 1}`],
          pageCount: Number(ort.pageCount) || (Array.isArray(ort.sourcePages) ? ort.sourcePages.length : 1) || 1,
        };
        // Validate + UNKNOWN fallback for partially illegible fields
        const { patched, report } = applyOrtFallbacks(reviewDoc);
        const unknownConfidences: Record<string, number> = { ...(reviewDoc.fieldConfidences || {}) };
        report.unknownFields.forEach(f => { unknownConfidences[f] = 0; });
        const finalDoc: OrtReviewDocument = {
          ...reviewDoc,
          ...patched,
          fieldConfidences: unknownConfidences,
          unknownFields: report.unknownFields,
          needsReview: reviewDoc.needsReview || report.unknownFields.length > 0,
        };
        return { ...finalDoc, extractedPayload: toOrtAuditPayload(finalDoc) };
      });

      const { uniqueDocs, batchDuplicates, existingDuplicates } = dedupeOrtReviewDocs(docs, existingDocs);

      if (uniqueDocs.length === 0) {
        toast({ title: 'Nenhum documento novo encontrado', description: 'Todas as NF-e/ORTs enviadas já estavam duplicadas.', variant: 'destructive' });
        return;
      }

      setOrtReviewDocs(uniqueDocs);
      setValidatedOrders([]);
      setStep(1);
      const parts: string[] = [];
      if (batchDuplicates) parts.push(`${batchDuplicates} scan(s) unificado(s) ao mesmo cliente`);
      if (existingDuplicates) parts.push(`${existingDuplicates} já existente(s) no sistema ignorada(s)`);
      const dedupeText = parts.length ? ` ${parts.join('; ')}.` : '';
      toast({ title: 'Scans processados', description: `${uniqueDocs.length} NF-e/ORT(s) pronta(s) para revisão.${dedupeText}` });
    } catch (e: unknown) {
      toast({ title: 'Erro ao ler NF-e/ORT', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setOrtProcessing(false);
    }
  }, [currentTenant?.id, existingDocs, reviewThreshold, toast]);

  const handleUpdateOrtReviewDoc = useCallback((index: number, updates: Partial<OrtReviewDocument>) => {
    const TRACKED_FIELDS: Partial<Record<keyof OrtReviewDocument, string>> = {
      issueDate: 'Emissão',
      paymentTerms: 'Prazo de pagamento',
      billing: 'Cobrança',
      cargoDescription: 'Carga',
      recipientName: 'Destinatário',
      recipientCnpj: 'CNPJ destinatário',
      recipientPhone: 'Telefone',
      recipientAddress: 'Endereço',
      recipientAddressNumber: 'Número',
      recipientZip: 'CEP',
      recipientNeighborhood: 'Bairro',
      recipientCity: 'Cidade',
      recipientState: 'UF',
      invoiceNumber: 'Nº ORT',
      accessKey: 'Chave NF-e',
      totalValue: 'Valor',
      totalWeight: 'Peso',
      estimatedPallets: 'Paletes',
    };
    const actor = user?.email || user?.id || 'usuário';
    const now = new Date().toISOString();
    setOrtReviewDocs(prev => prev.map((doc, i) => {
      if (i !== index) return doc;
      const newEntries: OrtAuditEntry[] = [];
      for (const key of Object.keys(TRACKED_FIELDS) as Array<keyof OrtReviewDocument>) {
        const label = TRACKED_FIELDS[key];
        if (!label) continue;
        if (!(key in updates)) continue;
        const prevVal = doc[key];
        const nextVal = updates[key];
        const prevStr = prevVal == null ? '' : String(prevVal);
        const nextStr = nextVal == null ? '' : String(nextVal);
        if (prevStr !== nextStr) {
          newEntries.push({
            field: key,
            fieldLabel: label,
            previousValue: prevStr,
            newValue: nextStr,
            changedAt: now,
            changedBy: actor,
          });
        }
      }
      const auditLog = newEntries.length > 0 ? [...(doc.auditLog || []), ...newEntries] : doc.auditLog;
      return { ...doc, ...updates, needsReview: false, auditLog };
    }));
  }, [user]);

  const handleConfirmOrtReview = useCallback(() => {
    const indexes = buildValidationIndexes(existingDocs, clients);
    const seenReviewKeys = new Set<string>();
    const docs = ortReviewDocs.map((ort, idx) => {
      const isNfe = ort.documentKind === 'nfe';
      const referenceNumber = isNfe ? null : buildOrtAccessKey(ort, `DOC${idx + 1}`);
      const accessKey = isNfe ? normalizeNfeAccessKey(ort.accessKey) : '';
      const parsed: ParsedNFe = {
        invoiceNumber: ort.invoiceNumber,
        series: isNfe ? '' : 'ORT',
        model: isNfe ? '55' : 'ORT',
        accessKey,
        issueDate: ort.issueDate,
        emitterName: ort.emitterName,
        emitterCnpj: ort.emitterCnpj,
        recipientName: ort.recipientName,
        recipientCnpj: ort.recipientCnpj,
        recipientFantasyName: ort.recipientFantasyName || '',
        recipientStateRegistration: ort.recipientStateRegistration || '',
        recipientMunicipalRegistration: ort.recipientMunicipalRegistration || '',
        recipientIeIndicator: ort.recipientIeIndicator || '',
        recipientPhone: ort.recipientPhone || '',
        recipientEmail: ort.recipientEmail || '',
        recipientCity: ort.recipientCity,
        recipientCityCode: ort.recipientCityCode || '',
        recipientState: ort.recipientState,
        recipientAddress: ort.recipientAddress,
        recipientAddressNumber: ort.recipientAddressNumber || '',
        recipientAddressComplement: ort.recipientAddressComplement || '',
        recipientNeighborhood: ort.recipientNeighborhood,
        recipientZip: ort.recipientZip || '',
        recipientCountry: ort.recipientCountry || '',
        recipientCountryCode: ort.recipientCountryCode || '',
        items: mapOrtItems(ort),
        totalValue: ort.totalValue || 0,
        totalWeight: ort.totalWeight || 0,
        totalVolume: ort.totalVolume || 0,
        estimatedPallets: ort.estimatedPallets || 0,
        clientLoadNumber: '',
        observation: '',
        sourceKind: isNfe ? 'scan_nfe' : 'scan_ort',
        referenceNumber,
        productSummary: ort.productSummary || null,
        paymentTerms: ort.paymentTerms || '',
      };
      const validated = validateNFe(parsed, `${isNfe ? 'NF-e' : 'ORT'} ${ort.fileName}`, existingDocs, clients, indexes);
      const reviewIdentity = accessKey || referenceNumber || `SCAN-${idx}`;
      if (seenReviewKeys.has(reviewIdentity)) {
        validated.validations.push({ field: 'fiscalIdentity', message: 'Documento duplicado neste lote de importação', severity: 'error' });
        validated.hasErrors = true;
        validated.isDuplicate = true;
      }
      seenReviewKeys.add(reviewIdentity);
      if (ort.needsReview || ort.confidence < reviewThreshold) {
        validated.validations.push({ field: 'ortConfidence', message: 'ORT tinha campos de baixa confiança — revisão manual realizada', severity: 'info' });
      }
      return validated;
    });
    setValidatedDocs(docs);
    setValidatedOrders([]);
    setStep(2);
  }, [clients, existingDocs, ortReviewDocs, reviewThreshold]);

  // Inline editing callbacks
  const handleUpdateDoc = useCallback((index: number, updates: Partial<ValidatedDocument>) => {
    setValidatedDocs(prev => prev.map((d, i) => i === index ? { ...d, ...updates } : d));
  }, []);

  const handleUpdateOrder = useCallback((index: number, updates: Partial<ValidatedOrder>) => {
    setValidatedOrders(prev => prev.map((o, i) => i === index ? { ...o, ...updates } : o));
  }, []);

  const handleRemoveDoc = useCallback((index: number) => {
    setValidatedDocs(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleRemoveOrder = useCallback((index: number) => {
    setValidatedOrders(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSaveDocsOnly = async (loadId?: string | null) => {
    setSavingDocsOnly(true);
    if (pickupOrderId && remitterMismatchDocs.length > 0) {
      setSavingDocsOnly(false);
      toast({
        title: 'Vínculo de coleta bloqueado',
        description: `${remitterMismatchDocs.length} XML(s) com remetente diferente do cadastrado na coleta. Remova-os ou troque a coleta.`,
        variant: 'destructive',
      });
      return;
    }
    // Auto-cadastro de cliente: se XML/ORT trouxe destinatário não vinculado,
    // cria o cliente uma vez por CNPJ (ou nome) preenchendo todos os dados disponíveis.
    const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');
    const autoCreatedByCnpj = new Map<string, string>(); // chave: CNPJ digits, valor: client_id
    const autoCreatedByName = new Map<string, string>();
    const autoCreatedByIe = new Map<string, string>(); // chave: UF|IE digits
    const autoCreatedByIm = new Map<string, string>(); // chave: município|IM digits
    let autoCreatedCount = 0;
    let ieUpdatedCount = 0;
    const clientsToSyncSsx = new Set<string>(); // client_ids para sincronizar com SSX

    const ensureClient = async (src: ParsedNFe): Promise<string | null> => {
      if (!currentTenant) return null;
      const cnpjDigits = onlyDigits(src.recipientCnpj);
      const nameKey = (src.recipientName || '').trim().toLowerCase();
      const ieRawForKey = src.recipientStateRegistration || '';
      const ieIsUnknownOrIsento = /^(UNKNOWN|ISENTO|ISENTA|IS|EX)$/i.test(String(ieRawForKey).trim());
      const ieDigits = ieIsUnknownOrIsento ? '' : onlyDigits(ieRawForKey);
      const imDigits = onlyDigits(src.recipientMunicipalRegistration);
      const uf = (src.recipientState || '').trim().toUpperCase();
      const cityKey = (src.recipientCity || '').trim().toLowerCase();
      const ieKey = ieDigits ? `${uf}|${ieDigits}` : '';
      const imKey = imDigits ? `${cityKey}|${imDigits}` : '';

      // Cliente já cadastrado sem IE (ou com IE inválida/UNKNOWN): puxa a IE da
      // nota e atualiza o cadastro, evitando rejeição da SEFAZ na emissão do CT-e.
      const backfillIe = async (clientId: string) => {
        const existing = clients.find(c => c.id === clientId);
        const currentIe = String(existing?.state_registration || '').trim();
        const currentValid = currentIe && !/^(UNKNOWN|N\/?I|N\/?A|0+|-+|\?+)$/i.test(currentIe);
        if (currentValid) return;
        const norm = normalizeStateRegistration(ieRawForKey, uf);
        if (norm.unknown || !norm.value) return;
        const ind = normalizeIeIndicator(src.recipientIeIndicator, norm);
        const patch: TablesUpdate<'clients'> = { state_registration: norm.value, updated_by: user?.id };
        if (ind.description) {
          patch.ie_indicator = ind.description;
          patch.tax_description = ind.description;
          patch.taxes_enabled = ind.taxesEnabled;
        }
        const { error } = await supabase.from('clients').update(patch).eq('id', clientId).eq('tenant_id', currentTenant.id);
        if (!error) {
          ieUpdatedCount++;
          if (existing) existing.state_registration = norm.value;
        }
      };

      // Já existe no cadastro? (match por CNPJ + Cidade → Anti-erro de filial)
      if (cnpjDigits) {
        const matches = clients.filter(c => onlyDigits(c.tax_id || '') === cnpjDigits);
        if (matches.length > 1 && cityKey) {
          const byCity = matches.find(c => (c.address_city || '').trim().toLowerCase() === cityKey);
          if (byCity) { await backfillIe(byCity.id); return byCity.id; }
        }
        if (matches.length > 0) { await backfillIe(matches[0].id); return matches[0].id; }
        if (autoCreatedByCnpj.has(cnpjDigits)) return autoCreatedByCnpj.get(cnpjDigits)!;
      }
      // Match por IE (com mesma UF quando disponível) — evita duplicar quando CNPJ não foi extraído
      if (ieDigits) {
        const existingByIe = clients.find(c => {
          const cIe = onlyDigits(c.state_registration || '');
          if (!cIe || cIe !== ieDigits) return false;
          const cUf = (c.address_state || '').trim().toUpperCase();
          return !uf || !cUf || cUf === uf;
        });
        if (existingByIe) return existingByIe.id;
        if (autoCreatedByIe.has(ieKey)) return autoCreatedByIe.get(ieKey)!;
      }
      // Match por IM (com mesma cidade quando disponível)
      if (imDigits) {
        const existingByIm = clients.find(c => {
          const cIm = onlyDigits(c.municipal_registration || '');
          if (!cIm || cIm !== imDigits) return false;
          const cCity = (c.address_city || '').trim().toLowerCase();
          return !cityKey || !cCity || cCity === cityKey;
        });
        if (existingByIm) { await backfillIe(existingByIm.id); return existingByIm.id; }
        if (autoCreatedByIm.has(imKey)) return autoCreatedByIm.get(imKey)!;
      }
      if (nameKey) {
        const existingByName = clients.find(c => (c.company_name || '').trim().toLowerCase() === nameKey);
        if (existingByName) { await backfillIe(existingByName.id); return existingByName.id; }
        if (!cnpjDigits && autoCreatedByName.has(nameKey)) return autoCreatedByName.get(nameKey)!;
      }

      // Sem dado mínimo, não cria
      const recipientName = src.recipientName;
      if (!recipientName && !cnpjDigits) return null;

      const taxId = cnpjDigits
        ? (cnpjDigits.length === 14
            ? `${cnpjDigits.slice(0,2)}.${cnpjDigits.slice(2,5)}.${cnpjDigits.slice(5,8)}/${cnpjDigits.slice(8,12)}-${cnpjDigits.slice(12)}`
            : cnpjDigits.length === 11
              ? `${cnpjDigits.slice(0,3)}.${cnpjDigits.slice(3,6)}.${cnpjDigits.slice(6,9)}-${cnpjDigits.slice(9)}`
              : cnpjDigits)
        : null;

      const zipDigits = onlyDigits(src.recipientZip);
      const zip = zipDigits.length === 8 ? `${zipDigits.slice(0,5)}-${zipDigits.slice(5)}` : null;

      // Endereço completo do destinatário (XML/ORT) — preserva número 'S/N' quando aplicável,
      // normaliza UF para 2 letras e código IBGE para 7 dígitos, e mantém código/nome do país.
      const sanitizeText = (v?: string | null) => {
        const t = (v || '').trim();
        if (!t) return null;
        if (/^(UNKNOWN|N\/?I|N\/?A)$/i.test(t)) return null;
        return t.replace(/\s+/g, ' ');
      };
      const rawNumber = (src.recipientAddressNumber || '').trim();
      const addressNumber = rawNumber
        ? (/^(s\/?n|sem n[úu]mero)$/i.test(rawNumber) ? 'S/N' : rawNumber)
        : null;
      const ufRaw = (src.recipientState || '').trim().toUpperCase();
      const addressState = /^[A-Z]{2}$/.test(ufRaw) ? ufRaw : (ufRaw || null);
      const ibgeDigits = onlyDigits(src.recipientCityCode);
      const ibgeCode = ibgeDigits.length === 7 ? ibgeDigits : null;
      const countryCodeRaw = onlyDigits(src.recipientCountryCode);
      const countryCode = countryCodeRaw || '1058';
      const countryName = sanitizeText(src.recipientCountry) || 'BRASIL';

      // Derivações fiscais a partir da nota
      const isCpf = cnpjDigits.length === 11;
      const ieRaw = src.recipientStateRegistration || '';
      const ieNorm = normalizeStateRegistration(ieRaw, src.recipientState);
      const indIeNorm = normalizeIeIndicator(src.recipientIeIndicator, ieNorm);
      const taxCode = indIeNorm.code === '1' ? 'C'
        : indIeNorm.code === '2' ? 'I0'
        : indIeNorm.code === '9' ? 'NC'
        : indIeNorm.code === FISCAL_UNKNOWN ? FISCAL_UNKNOWN
        : null;
      const taxDescription = indIeNorm.description;
      // CFOP do primeiro item indica natureza (5xxx/6xxx = venda → Comércio; 1xxx/2xxx = entrada)
      const firstCfop = String(src.items[0]?.cfop || '').replace(/\D/g, '');
      const cfopFirst = firstCfop ? firstCfop.charAt(0) : '';
      const cfopClientType = ['5','6','7'].includes(cfopFirst) ? 'Comércio'
        : ['1','2','3'].includes(cfopFirst) ? 'Comércio'
        : null;

      const payload: TablesInsert<'clients'> = {
        tenant_id: currentTenant.id,
        company_name: recipientName || taxId || 'Sem nome',
        legal_name: recipientName || null,
        trade_name: src.recipientFantasyName || null,
        tax_id: taxId,
        person_type: isCpf ? 'CPF' : 'CNPJ',
        client_type: isCpf ? 'PF' : 'PJ',
        // Nunca gravar o marcador 'UNKNOWN' na IE: ele vazava para o payload do
        // CT-e e a SEFAZ rejeitava a emissão por IE inválida.
        state_registration: ieNorm.unknown ? null : ieNorm.value,
        municipal_registration: src.recipientMunicipalRegistration || null,
        ie_indicator: taxDescription,
        tax_code: taxCode,
        tax_description: taxDescription,
        taxes_enabled: indIeNorm.taxesEnabled,
        cfop_client_type: cfopClientType,
        freight_calc_type: 'PESO',
        address_street: sanitizeText(src.recipientAddress),
        address_number: addressNumber,
        address_complement: sanitizeText(src.recipientAddressComplement),
        address_neighborhood: sanitizeText(src.recipientNeighborhood),
        address_city: sanitizeText(src.recipientCity),
        address_state: addressState,
        address_zip: zip,
        address_city_ibge_code: ibgeCode,
        address_country_code: countryCode,
        address_country_name: countryName,
        country_name: countryName,
        country_code: countryCode,
        email: src.recipientEmail || null,
        phone: src.recipientPhone || null,
        mobile: src.recipientPhone || null,
        contact_name: recipientName || null,
        active: true,
        blocked: false,
        billed: false,
        notes: 'Cadastrado automaticamente via importação de XML/ORT',
        created_by: user?.id,
      };
      try {
        const { data, error } = await supabase.from('clients').insert(payload).select('id').single();
        if (error || !data) return null;
        autoCreatedCount++;
        if (cnpjDigits) autoCreatedByCnpj.set(cnpjDigits, data.id);
        if (ieKey) autoCreatedByIe.set(ieKey, data.id);
        if (imKey) autoCreatedByIm.set(imKey, data.id);
        if (nameKey) autoCreatedByName.set(nameKey, data.id);
        clientsToSyncSsx.add(data.id);
        return data.id;
      } catch {
        return null;
      }
    };

    const results: string[] = [];
    try {
      for (const doc of validatedDocs.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable))) {
        const savedId = doc._savedId || (doc.isOrphanReusable ? doc.existingDocumentId : null);
        try {
          if (savedId) {
            // Já salvo no upload — vincula à carga via RPC oficial.
            if (loadId && currentTenant) {
              const { data: assignmentResult, error: assignmentError } = await supabase.rpc('assign_fiscal_documents_to_load_v2', {
                _tenant_id: currentTenant.id,
                _load_id: loadId,
                _document_ids: [savedId],
              });
              if (assignmentError) {
                throw new Error(`Falha ao vincular NF ${doc.source.invoiceNumber}: ${assignmentError.message}`);
              }
              const updatedCount = getJsonNumber(assignmentResult, 'updated') ?? 1;
              if (updatedCount !== 1) {
                throw new Error(`Vínculo da NF ${doc.source.invoiceNumber} não foi confirmado pelo servidor.`);
              }
            }
            results.push(`✅ NF ${doc.source.invoiceNumber} ${loadId ? 'vinculada à carga' : '(já salva)'}`);
          } else {
            // Auto-vincula/cria cliente se ainda não houver
            if (!doc.matchedClientId) {
              const newId = await ensureClient(doc.source);
              if (newId) doc.matchedClientId = newId;
            }
            let freightValue: number | null = null;
            let freightBreakdown: FreightBreakdown | null = null;
            let freightTableId: string | null = null;
            if (currentTenant) {
              const freightResult = await calculateFreight({
                tenantId: currentTenant.id,
                clientId: doc.matchedClientId,
                destination: doc.source.recipientCity || null,
                destinationState: doc.source.recipientState || null,
                destinationMunicipality: doc.source.recipientCity || null,
                totalValue: doc.source.totalValue || 0,
                totalWeight: doc.source.totalWeight || 0,
                totalPallets: doc.source.estimatedPallets || 0,
              });
              if (freightResult.success && freightResult.breakdown) {
                freightValue = freightResult.value;
                freightBreakdown = freightResult.breakdown;
                freightTableId = freightResult.breakdown.tableId || null;
              }
            }

            const created = await createDoc.mutateAsync({
              document_type: 'inbound',
              invoice_number: doc.source.invoiceNumber,
              invoice_series: doc.source.series || null,
              fiscal_model: doc.source.model || '55',
              access_key: doc.source.accessKey,
              remitter: doc.source.emitterName,
              remitter_cnpj: doc.source.emitterCnpj || null,
              remitter_state_registration: doc.source.emitterStateRegistration || null,
              recipient: doc.source.recipientName,
              recipient_cnpj: doc.source.recipientCnpj || null,
              recipient_city: doc.source.recipientCity || null,
              recipient_state: doc.source.recipientState || null,
              recipient_neighborhood: doc.source.recipientNeighborhood || null,
              issue_date: doc.source.issueDate || null,
              client_id: doc.matchedClientId,
              product_summary: (doc.source.productSummary || doc.source.items.map(i => i.description).join(', ')).substring(0, 500),
              pallet_count: doc.source.estimatedPallets,
              weight_kg: doc.source.totalWeight,
              value: doc.source.totalValue,
              freight_value: freightValue,
              freight_breakdown: freightBreakdown ? toJson(freightBreakdown) : null,
              freight_table_id: freightTableId,
              status: 'confirmed',
              load_id: loadId || null,
              pickup_order_id: pickupOrderId || null,
              client_load_number: doc.source.clientLoadNumber || null,
              reference_number: doc.source.referenceNumber || null,
              client_load_source: doc.source.clientLoadNumber
                ? {
                    source: doc.source.clientLoadSource || 'none',
                    ruleId: doc.source.clientLoadRuleId || null,
                    ruleLabel: doc.source.clientLoadRuleLabel || null,
                    observationSnippet: doc.source.observation
                      ? String(doc.source.observation).replace(/\s+/g, ' ').trim().slice(0, 400)
                      : null,
                  }
                : (doc.source.observation
                    ? {
                        source: 'none',
                        observationSnippet: String(doc.source.observation).replace(/\s+/g, ' ').trim().slice(0, 400),
                      }
                    : null),
                delivery_meta: (() => {
                  const src = doc.source;
                  const sourceMeta = {
                    ingestion_source: src.sourceKind || 'xml',
                    // Preserve source evidence even when normalization requires review.
                    recipient_fiscal: {
                      cnpj: src.recipientCnpj || null,
                      state_registration: src.recipientStateRegistration || null,
                      ie_indicator: src.recipientIeIndicator || null,
                      uf: src.recipientState || null,
                    },
                  };
                  if (src.paymentMethod) {
                    return {
                      ...sourceMeta,
                      payment_method: src.paymentMethod,
                      payment_method_source: src.paymentMethodSource || 'tpag',
                      payment_method_code: src.paymentMethodCode || null,
                    };
                  }
                  const r = detectPaymentMethodDetailed(src.observation, src.paymentTerms);
                  return r.value
                    ? { ...sourceMeta, payment_method: r.value, payment_method_source: r.source === 'context' ? 'infcpl_context' : 'infcpl_keyword' }
                    : sourceMeta;
                })(),
            });

            if (freightValue && freightBreakdown?.tableId && currentTenant) {
              await logFreightCalculation(currentTenant.id, created.id, 'fiscal_document', freightBreakdown, user?.id);
            }

            await recordOrtAudit(doc, created.id, loadId ? 'saved_and_linked' : 'saved');

            const freightLabel = freightValue ? ` (frete: R$ ${freightValue.toFixed(2)})` : '';
            results.push(`✅ NF ${doc.source.invoiceNumber} salva${freightLabel}`);
          }
        } catch (e: unknown) {
          results.push(`❌ NF ${doc.source.invoiceNumber}: ${getErrorMessage(e)}`);
        }
      }

      setExecutionResults(results);
      setStep(5);

      const successCount = results.filter(r => r.startsWith('✅')).length;
      const errorCount = results.filter(r => r.startsWith('❌')).length;
      const validDocsForReport = validatedDocs.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable));
      const matchedExisting = validDocsForReport.filter(d =>
        d.matchedClientId && !clientsToSyncSsx.has(d.matchedClientId)
      ).length;
      const baseSaveLabel = loadId
        ? `Vinculado à carga ${loads.find(l => l.id === loadId)?.load_number || ''}`
        : 'Salvar documentos';
      const saveLabel = `${baseSaveLabel}${reprocessSuffix}`;
      const reportSaveDocs = buildIngestionReport({
        docs: validDocsForReport,
        ortReviewDocs,
        savedCount: successCount,
        errorCount,
        autoCreatedCount: autoCreatedCount,
        matchedCount: matchedExisting,
        reviewThreshold,
        sourceLabel: saveLabel,
        tenant: currentTenant,
        generatedByUserId: user?.id,
      });
      setIngestionReport(reportSaveDocs);
      void persistIngestionReport(reportSaveDocs, saveLabel);
      const loadLabel = loadId ? loads.find(l => l.id === loadId)?.load_number : null;
      if (autoCreatedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ['clients'] });
        toast({
          title: `${autoCreatedCount} cliente(s) cadastrado(s) automaticamente`,
          description: 'Dados extraídos do XML/ORT foram salvos na ficha do cliente.',
        });
      }
      if (ieUpdatedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ['clients'] });
        toast({
          title: `IE atualizada em ${ieUpdatedCount} cliente(s)`,
          description: 'A Inscrição Estadual foi puxada da nota e gravada no cadastro.',
        });
      }

      // Sincronização opcional com SSX (InsertPerson) para os clientes recém-criados
      if (ssxEnabled && syncSsxClients && ssxAccountForClients?.id && currentTenant && clientsToSyncSsx.size > 0) {
        let okCount = 0;
        let errCount = 0;
        for (const cId of clientsToSyncSsx) {
          try {
            const { data, error } = await supabase.functions.invoke<SsxInsertPersonResponse>('ssx-insert-person-client', {
              body: { tenant_id: currentTenant.id, client_id: cId, integration_account_id: ssxAccountForClients.id },
            });
            if (error || data?.error) errCount++;
            else okCount++;
          } catch {
            errCount++;
          }
        }
        toast({
          title: 'Sincronização SSX concluída',
          description: `${okCount} cliente(s) sincronizados${errCount ? `, ${errCount} com erro` : ''}.`,
          variant: errCount && !okCount ? 'destructive' : 'default',
        });
      }

      toast({
        title: 'NF-es salvas',
        description: loadLabel
          ? `${successCount} documentos vinculados à carga ${loadLabel}.`
          : `${successCount} documentos salvos. Agrupe em cargas quando quiser na página de Cargas.`,
      });
    } catch (e: unknown) {
      toast({ title: 'Erro', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setSavingDocsOnly(false);
    }
  };

  const handleGoToRouting = () => {
    setStep(3);
  };

  const handleRoutingNext = async (groups: RouteGroup[]) => {

    // ── Auto-save valid docs to DB at grouping step so nothing is lost ──
    const validDocs = validatedDocs.filter(d => !d.hasErrors && !d.isDuplicate && !d._savedId);
    let savedCount = 0;
    for (const doc of validDocs) {
      try {
        let freightValue: number | null = null;
        let freightBreakdown: FreightBreakdown | null = null;
        let freightTableId: string | null = null;
        if (currentTenant) {
          const freightResult = await calculateFreight({
            tenantId: currentTenant.id,
            clientId: doc.matchedClientId,
            destination: doc.source.recipientCity || null,
            destinationState: doc.source.recipientState || null,
            destinationMunicipality: doc.source.recipientCity || null,
            totalValue: doc.source.totalValue || 0,
            totalWeight: doc.source.totalWeight || 0,
            totalPallets: doc.source.estimatedPallets || 0,
          });
          if (freightResult.success && freightResult.breakdown) {
            freightValue = freightResult.value;
            freightBreakdown = freightResult.breakdown;
            freightTableId = freightResult.breakdown.tableId || null;
          }
        }

        const created = await createDoc.mutateAsync({
          document_type: 'inbound',
          invoice_number: doc.source.invoiceNumber,
          invoice_series: doc.source.series || null,
          fiscal_model: doc.source.model || '55',
          access_key: doc.source.accessKey,
          remitter: doc.source.emitterName,
          remitter_cnpj: doc.source.emitterCnpj || null,
          remitter_state_registration: doc.source.emitterStateRegistration || null,
          recipient: doc.source.recipientName,
          recipient_cnpj: doc.source.recipientCnpj || null,
          recipient_city: doc.source.recipientCity || null,
          recipient_state: doc.source.recipientState || null,
          recipient_neighborhood: doc.source.recipientNeighborhood || null,
          issue_date: doc.source.issueDate || null,
          client_id: doc.matchedClientId,
          product_summary: (doc.source.productSummary || doc.source.items.map(i => i.description).join(', ')).substring(0, 500),
          pallet_count: doc.source.estimatedPallets,
          weight_kg: doc.source.totalWeight,
          value: doc.source.totalValue,
          freight_value: freightValue,
          freight_breakdown: freightBreakdown ? toJson(freightBreakdown) : null,
          freight_table_id: freightTableId,
          status: 'confirmed',
          pickup_order_id: pickupOrderId || null,
          client_load_number: doc.source.clientLoadNumber || null,
          reference_number: doc.source.referenceNumber || null,
          client_load_source: doc.source.clientLoadNumber
            ? {
                source: doc.source.clientLoadSource || 'none',
                ruleId: doc.source.clientLoadRuleId || null,
                ruleLabel: doc.source.clientLoadRuleLabel || null,
                observationSnippet: doc.source.observation
                  ? String(doc.source.observation).replace(/\s+/g, ' ').trim().slice(0, 400)
                  : null,
              }
            : (doc.source.observation
                ? {
                    source: 'none',
                    observationSnippet: String(doc.source.observation).replace(/\s+/g, ' ').trim().slice(0, 400),
                  }
                : null),
          delivery_meta: (() => {
            const src = doc.source;
            const sourceMeta = {
                    ingestion_source: src.sourceKind || 'xml',
                    // Preserve source evidence even when normalization requires review.
                    recipient_fiscal: {
                      cnpj: src.recipientCnpj || null,
                      state_registration: src.recipientStateRegistration || null,
                      ie_indicator: src.recipientIeIndicator || null,
                      uf: src.recipientState || null,
                    },
                  };
            if (src.paymentMethod) {
              return {
                ...sourceMeta,
                payment_method: src.paymentMethod,
                payment_method_source: src.paymentMethodSource || 'tpag',
                payment_method_code: src.paymentMethodCode || null,
              };
            }
            const r = detectPaymentMethodDetailed(src.observation, src.paymentTerms);
            return r.value
              ? { ...sourceMeta, payment_method: r.value, payment_method_source: r.source === 'context' ? 'infcpl_context' : 'infcpl_keyword' }
              : sourceMeta;
          })(),
        });

        doc._savedId = created.id;
        // mantém forma de pagamento detectada disponível em delivery_meta também aqui

        if (freightValue && freightBreakdown?.tableId && currentTenant) {
          await logFreightCalculation(currentTenant.id, created.id, 'fiscal_document', freightBreakdown, user?.id);
        }

        await recordOrtAudit(doc, created.id, 'auto_saved_for_grouping');
        savedCount++;
      } catch {
        // Will still proceed to grouping
      }
    }

    if (savedCount > 0) {
      toast({
        title: `${savedCount} NF-e(s) salvas automaticamente`,
        description: 'Documentos salvos no banco. Mesmo que feche a página, não serão perdidos.',
      });
    }

    // Convert route groups to LoadSuggestions for the GroupingStep
    const loadSuggestions: LoadSuggestion[] = groups.map(g => ({
      region: g.routeName,
      routeId: g.routeId,
      routeName: g.routeId ? g.routeName : null,
      documents: g.documents,
      orders: g.orders,
      totalPallets: g.totalPallets,
      totalWeight: g.totalWeight,
      totalValue: g.totalValue,
      stopCount: g.documents.length + g.orders.length,
    }));
    setSuggestions(loadSuggestions);
    setStep(4);
  };

  const handleExecute = async (assignments: Map<number, { vehicleId: string | null; driverId: string | null }>) => {
    if(itemPreparations.isPending || itemPreparations.pending.length || itemPreparations.recoveryError){
      toast({title:'Recupere a preparação pendente antes de executar novamente',description:itemPreparations.recoveryError||'Use o painel de recuperação no topo da página.',variant:'destructive'});
      return;
    }
    setExecuting(true);
    const results: string[] = [];

    if (!currentTenant) {
      toast({ title: 'Empresa não selecionada', description: 'Selecione uma empresa antes de criar as cargas.', variant: 'destructive' });
      setExecuting(false);
      return;
    }

    // Track created entities for linking
    const createdDocIds: Map<string, string> = new Map(); // fiscal identity/access key -> id
    const createdOrderIds: Map<string, string> = new Map(); // orderNumber -> id

    try {
      // 1. Map fiscal documents (already saved on upload)
      for (const doc of validatedDocs.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable))) {
        const savedId = doc._savedId;
        if (savedId) {
          createdDocIds.set(getValidatedDocKey(doc), savedId);
          results.push(`✅ NF ${doc.source.invoiceNumber} (já salva)`);
        } else if (doc.isOrphanReusable && doc.existingDocumentId) {
          // Retomada de importação: NF já existia no banco sem carga vinculada.
          createdDocIds.set(getValidatedDocKey(doc), doc.existingDocumentId);
          doc._savedId = doc.existingDocumentId;
          results.push(`✅ NF ${doc.source.invoiceNumber} reaproveitada (já existia sem carga)`);
        } else {
          // Fallback: save now if somehow not saved earlier
          try {
            let freightValue: number | null = null;
            let freightBreakdown: FreightBreakdown | null = null;
            let freightTableId: string | null = null;
            if (currentTenant) {
              const freightResult = await calculateFreight({
                tenantId: currentTenant.id,
                clientId: doc.matchedClientId,
                destination: doc.source.recipientCity || null,
                destinationState: doc.source.recipientState || null,
                destinationMunicipality: doc.source.recipientCity || null,
                totalValue: doc.source.totalValue || 0,
                totalWeight: doc.source.totalWeight || 0,
                totalPallets: doc.source.estimatedPallets || 0,
              });
              if (freightResult.success && freightResult.breakdown) {
                freightValue = freightResult.value;
                freightBreakdown = freightResult.breakdown;
                freightTableId = freightResult.breakdown.tableId || null;
              }
            }

            const created = await createDoc.mutateAsync({
              document_type: 'inbound',
              invoice_number: doc.source.invoiceNumber,
              invoice_series: doc.source.series || null,
              fiscal_model: doc.source.model || '55',
              access_key: doc.source.accessKey,
              remitter: doc.source.emitterName,
              remitter_cnpj: doc.source.emitterCnpj || null,
              remitter_state_registration: doc.source.emitterStateRegistration || null,
              recipient: doc.source.recipientName,
              recipient_cnpj: doc.source.recipientCnpj || null,
              recipient_city: doc.source.recipientCity || null,
              recipient_state: doc.source.recipientState || null,
              recipient_neighborhood: doc.source.recipientNeighborhood || null,
              issue_date: doc.source.issueDate || null,
              client_id: doc.matchedClientId,
              product_summary: (doc.source.productSummary || doc.source.items.map(i => i.description).join(', ')).substring(0, 500),
              pallet_count: doc.source.estimatedPallets,
              weight_kg: doc.source.totalWeight,
              value: doc.source.totalValue,
              freight_value: freightValue,
              freight_breakdown: freightBreakdown ? toJson(freightBreakdown) : null,
              freight_table_id: freightTableId,
              status: 'confirmed',
              pickup_order_id: pickupOrderId || null,
              client_load_number: doc.source.clientLoadNumber || null,
              reference_number: doc.source.referenceNumber || null,
              client_load_source: doc.source.clientLoadNumber
                ? {
                    source: doc.source.clientLoadSource || 'none',
                    ruleId: doc.source.clientLoadRuleId || null,
                    ruleLabel: doc.source.clientLoadRuleLabel || null,
                    observationSnippet: doc.source.observation
                      ? String(doc.source.observation).replace(/\s+/g, ' ').trim().slice(0, 400)
                      : null,
                  }
                : (doc.source.observation
                    ? {
                        source: 'none',
                        observationSnippet: String(doc.source.observation).replace(/\s+/g, ' ').trim().slice(0, 400),
                      }
                    : null),
                delivery_meta: (() => {
                  const src = doc.source;
                  const sourceMeta = {
                    ingestion_source: src.sourceKind || 'xml',
                    // Preserve source evidence even when normalization requires review.
                    recipient_fiscal: {
                      cnpj: src.recipientCnpj || null,
                      state_registration: src.recipientStateRegistration || null,
                      ie_indicator: src.recipientIeIndicator || null,
                      uf: src.recipientState || null,
                    },
                  };
                  if (src.paymentMethod) {
                    return {
                      ...sourceMeta,
                      payment_method: src.paymentMethod,
                      payment_method_source: src.paymentMethodSource || 'tpag',
                      payment_method_code: src.paymentMethodCode || null,
                    };
                  }
                  const r = detectPaymentMethodDetailed(src.observation, src.paymentTerms);
                  return r.value
                    ? { ...sourceMeta, payment_method: r.value, payment_method_source: r.source === 'context' ? 'infcpl_context' : 'infcpl_keyword' }
                    : sourceMeta;
                })(),
            });
            createdDocIds.set(getValidatedDocKey(doc), created.id);

            if (freightValue && freightBreakdown?.tableId && currentTenant) {
              await logFreightCalculation(currentTenant.id, created.id, 'fiscal_document', freightBreakdown, user?.id);
            }

            await recordOrtAudit(doc, created.id, 'imported_on_execute');

            const freightLabel = freightValue ? ` (frete: R$ ${freightValue.toFixed(2)})` : ' (sem tabela de frete)';
            results.push(`✅ NF ${doc.source.invoiceNumber} importada${freightLabel}`);
          } catch (e: unknown) {
            results.push(`❌ NF ${doc.source.invoiceNumber}: ${getErrorMessage(e)}`);
          }
        }
      }

      // 2. Create orders
      for (const order of validatedOrders.filter(o => !o.hasErrors)) {
        try {
          const created = await createOrder.mutateAsync({
            order_number: order.source.orderNumber,
            client_id: order.matchedClientId,
            destination: order.source.destination,
            pallet_count: order.source.palletCount,
            weight_kg: order.source.weightKg,
            quantity: order.source.quantity,
            promised_date: order.source.promisedDate || null,
            status: 'received',
          });
          createdOrderIds.set(order.source.orderNumber, created.id);
          results.push(`✅ Pedido ${order.source.orderNumber} criado`);
        } catch (e: unknown) {
          results.push(`❌ Pedido ${order.source.orderNumber}: ${getErrorMessage(e)}`);
        }
      }

      // 3. Create loads WITH load_items linked to documents/orders. The canonical
      // database command reserves each number atomically and returns it here.
      for (let idx = 0; idx < suggestions.length; idx++) {
        const suggestion = suggestions[idx];
        if (suggestion.totalPallets <= 0) continue;
        const assignment = assignments.get(idx);
        try {
          const docIds = suggestion.documents
            .map(d => createdDocIds.get(getValidatedDocKey(d)) || (d.isOrphanReusable ? d.existingDocumentId : null) || getPersistedDocumentId(d))
            .filter((id): id is string => !!id);

          if (suggestion.documents.length > 0 && docIds.length === 0) {
            throw new Error('Nenhuma NF pôde ser vinculada (todas duplicadas ou com erro na importação).');
          }

          if (suggestion.documents.length > 0 && docIds.length !== suggestion.documents.length) {
            throw new Error(`Somente ${docIds.length} de ${suggestion.documents.length} NF(s) ficaram disponíveis para vínculo. Carga não criada para evitar romaneio sem notas.`);
          }

          const createdLoad = await createLoad.mutateAsync({
            destination: suggestion.region,
            vehicle_id: assignment?.vehicleId || null,
            driver_id: assignment?.driverId || null,
            payment_method: (() => {
              const detectedMethods = suggestion.documents
                .map((doc) => doc.source.paymentMethod || detectPaymentMethodDetailed(doc.source.observation, doc.source.paymentTerms).value)
                .filter(Boolean) as string[];
              return detectedMethods[0] || null;
            })(),
            status: 'planned',
          });

          const loadId = createdLoad.id;
          const loadNumber = createdLoad.load_number;
          if (!loadNumber) throw new Error('Carga criada sem numeração confirmada pelo banco.');
          let itemsCreated = 0;

          // Vincula documentos à carga via RPC oficial (cria load_items + atualiza fiscal_documents + auditoria)
          if (docIds.length > 0 && currentTenant) {
            const { data: assignResult, error: assignErr } = await supabase.rpc('assign_fiscal_documents_to_load_v2', {
              _tenant_id: currentTenant.id,
              _load_id: loadId,
              _document_ids: docIds,
            });
            if (assignErr) {
              // Rollback: remove carga vazia para não deixar cargas sem notas
              try {
                await supabase.rpc('delete_load_safely', {
                  _tenant_id: currentTenant.id,
                  _load_id: loadId,
                });
              } catch {
                /* noop */
              }
              throw new Error(`Falha ao vincular ${docIds.length} NF(s): ${assignErr.message || assignErr}`);
            }

            const updatedCount = getJsonNumber(assignResult, 'updated') ?? docIds.length;
            if (updatedCount !== docIds.length) {
              try {
                await supabase.rpc('delete_load_safely', {
                  _tenant_id: currentTenant.id,
                  _load_id: loadId,
                });
              } catch {
                /* noop */
              }
              throw new Error(`Vínculo incompleto: ${updatedCount} de ${docIds.length} NF(s) foram associadas. Carga cancelada para não ficar sem notas.`);
            }
            itemsCreated += docIds.length;
          } else if (suggestion.documents.length > 0 && docIds.length === 0) {
            // Nenhuma das NFs da sugestão foi criada com sucesso (duplicadas ou erro de criação)
            try {
              await supabase.rpc('delete_load_safely', {
                _tenant_id: currentTenant.id,
                _load_id: loadId,
              });
            } catch {
              /* noop */
            }
            throw new Error('Nenhuma NF pôde ser vinculada (todas duplicadas ou com erro na importação).');
          }

          // Itens derivados de pedidos também passam pela composição canônica e auditável.
          itemsCreated=await prepareOrderItems({loadId,loadNumber,orders:suggestion.orders,orderIds:createdOrderIds,
            confirmedCount:itemsCreated,submit:itemPreparations.submit});

          results.push(`✅ Carga ${loadNumber} → ${suggestion.region} (${itemsCreated} itens vinculados)`);
        } catch (e: unknown) {
          results.push(`❌ Carga ${suggestion.region}: ${getErrorMessage(e)}`);
        }
      }

      setExecutionResults(results);
      setStep(5);

      const successCount = results.filter(r => r.startsWith('✅')).length;
      const errorCount = results.filter(r => r.startsWith('❌')).length;
      const validDocsForReport = validatedDocs.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable));
      const matchedExisting = validDocsForReport.filter(d => !!d.matchedClientId).length;
      const execLabel = `Execução completa de cargas${reprocessSuffix}`;
      const reportExec = buildIngestionReport({
        docs: validDocsForReport,
        ortReviewDocs,
        savedCount: successCount,
        errorCount,
        autoCreatedCount: 0,
        matchedCount: matchedExisting,
        reviewThreshold,
        sourceLabel: execLabel,
        tenant: currentTenant,
        generatedByUserId: user?.id,
      });
      setIngestionReport(reportExec);
      void persistIngestionReport(reportExec, execLabel);

      toast({
        title: 'Importação concluída',
        description: `${successCount} sucesso${errorCount > 0 ? `, ${errorCount} erros` : ''}`,
        variant: errorCount > 0 ? 'destructive' : 'default',
      });
    } catch (e: unknown) {
      toast({ title: 'Erro na execução', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  };

  const reset = () => {
    setStep(0);
    setValidatedDocs([]);
    setValidatedOrders([]);
    setOrtReviewDocs([]);
    setSuggestions([]);
    setExecutionResults([]);
    setIngestionReport(null);
  };

  return (
    <div className="animate-fade-in space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Upload className="h-5 w-5 text-primary" /> Importação
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Upload → Validação → Roteirização → Agrupamento → Execução</p>
      </div>

      {reprocessBatchId && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5 text-xs flex items-start gap-3">
          <FileStack className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 space-y-0.5">
            <div className="font-semibold text-foreground">
              Reprocessando lote <span className="font-mono">{reprocessBatchId}</span>
            </div>
            <div className="text-muted-foreground">
              Reenvie os mesmos arquivos do lote original. Documentos já cadastrados (mesma chave NF-e
              ou número) serão detectados e <strong>ignorados sem duplicar</strong> no banco. Apenas
              registros novos serão criados e o relatório final será marcado como reprocessamento.
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('reprocess');
              setSearchParams(next, { replace: true });
            }}
          >
            Sair do modo reprocessamento
          </Button>
        </div>
      )}

      {/* Confidence threshold calibrator for needsReview */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <label className="font-medium text-muted-foreground" htmlFor="review-threshold">
          Threshold de revisão (OCR/extração)
        </label>
        <input
          id="review-threshold"
          type="range"
          min={0.5}
          max={0.99}
          step={0.01}
          value={reviewThreshold}
          onChange={(e) => updateReviewThreshold(Number(e.target.value))}
          className="w-40 accent-primary"
        />
        <input
          type="number"
          min={0.5}
          max={0.99}
          step={0.01}
          value={reviewThreshold}
          onChange={(e) => updateReviewThreshold(Number(e.target.value))}
          className="w-20 rounded border bg-background px-2 py-1"
        />
        <span className="text-muted-foreground">
          Documentos com confiança abaixo de <strong>{Math.round(reviewThreshold * 100)}%</strong> serão marcados como <em>needsReview</em>.
        </span>
        <button
          type="button"
          onClick={() => updateReviewThreshold(0.82)}
          className="ml-auto rounded border px-2 py-1 hover:bg-muted"
        >
          Restaurar padrão (82%)
        </button>
      </div>

      <IngestionStepper currentStep={step} />

      {step >= 0 && step <= 4 && (
        <>
          <PickupOrderPicker
            value={pickupOrderId}
            noPickup={noPickup}
            onChange={(id, p) => { setPickupOrderId(id); setPickupOrder(p); if (id) setNoPickup(false); }}
            onNoPickupChange={setNoPickup}
          />
          {pickupOrderId && remitterMismatchDocs.length > 0 && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="py-3 text-sm">
                <strong className="text-destructive">⚠ {remitterMismatchDocs.length} XML(s) com remetente diferente do cadastrado na coleta nº {pickupOrder?.pickup_number}</strong>
                <div className="text-xs text-muted-foreground mt-1">
                  Esperado: <strong>{pickupOrder?.remitter_name}</strong>
                  {pickupOrder?.remitter_cnpj ? ` (${pickupOrder.remitter_cnpj})` : ''}.
                  Esses XMLs serão bloqueados ao salvar.
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {step === 0 && (
        <>
          <UploadStep onFiles={handleFiles} onOrtFiles={handleOrtFiles} ortProcessing={ortProcessing} />
          {/* Pending NF-es without load */}
          {(() => {
            const pending = existingDocs.filter(d => !d.load_id && d.status !== 'cancelled');
            if (pending.length === 0) return null;
            return (
              <Card className="mt-4 border-warning/30">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileText className="h-4 w-4 text-warning" />
                      <h3 className="text-sm font-semibold">{pending.length} NF-e(s) pendentes sem carga</h3>
                      <span className="text-[10px] text-muted-foreground">Salvas em importações anteriores e ainda não vinculadas a nenhuma carga</span>
                    </div>
                    <Button size="sm" onClick={() => setResumeOpen(true)} className="shrink-0 gap-1.5">
                      <FileStack className="h-3.5 w-3.5" />
                      Retomar agrupamento
                    </Button>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {pending.slice(0, 20).map(d => (
                      <div key={d.id} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-medium">NF {d.invoice_number || '—'}</span>
                          <span className="text-muted-foreground">{d.recipient || d.clients?.company_name || '—'}</span>
                          <span className="text-muted-foreground">{d.recipient_city || ''}{d.recipient_state ? ` - ${d.recipient_state}` : ''}</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          {d.pallet_count ? <span>{d.pallet_count} pal</span> : null}
                          {d.weight_kg ? <span>{Number(d.weight_kg).toLocaleString('pt-BR')} kg</span> : null}
                          <span>{d.issue_date ? new Date(d.issue_date + 'T12:00:00').toLocaleDateString('pt-BR') : ''}</span>
                        </div>
                      </div>
                    ))}
                    {pending.length > 20 && <div className="text-[10px] text-muted-foreground text-center py-1">+ {pending.length - 20} mais...</div>}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Clique em <strong>Retomar agrupamento</strong> para reagrupar essas NF-es por rota e atribuir veículos sem precisar reimportar.
                  </p>
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}

      <PendingDocsGrouping
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        onCreated={() => setResumeOpen(false)}
      />
      {step === 1 && (
        <ORTReviewStep
          docs={ortReviewDocs}
          onBack={reset}
          onUpdate={handleUpdateOrtReviewDoc}
          onConfirm={handleConfirmOrtReview}
          clientIds={ortClientIds}
          onSelectClient={(index, clientId) => setOrtClientIds(prev => {
            const next = [...prev];
            while (next.length <= index) next.push(null);
            next[index] = clientId;
            return next;
          })}
        />
      )}
      {step === 2 && (
        <>
        {ssxEnabled && ssxAccountForClients?.id && (
          <div className="mb-3 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <input
                id="sync-ssx-clients"
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={syncSsxClients}
                onChange={(e) => setSyncSsxClients(e.target.checked)}
              />
              <label htmlFor="sync-ssx-clients" className="cursor-pointer">
                Sincronizar clientes recém-criados com a SSX (InsertPerson)
              </label>
            </div>
            <span className="text-xs text-muted-foreground">conta: {ssxAccountForClients.username || 'SSX'}</span>
          </div>
        )}
        <ValidationStep
          docs={validatedDocs}
          orders={validatedOrders}
          clients={clients}
          loads={loads.map(l => ({ id: l.id, load_number: l.load_number, destination: l.destination, status: l.status }))}
          onBack={reset}
          onNext={handleGoToRouting}
          onSaveDocsOnly={handleSaveDocsOnly}
          savingDocs={savingDocsOnly}
          onUpdateDoc={handleUpdateDoc}
          onUpdateOrder={handleUpdateOrder}
          onRemoveDoc={handleRemoveDoc}
          onRemoveOrder={handleRemoveOrder}
        />
        </>
      )}
      {step === 3 && (
        <RoutingStep
          docs={validatedDocs}
          orders={validatedOrders}
          routes={(() => {
            const seen = new Set<string>();
            return operationalRoutes
              .filter(r => r.active !== false)
              .filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; })
              .map(r => ({
                id: r.id,
                name: r.name,
                destinations: Array.isArray(r.destinations) ? r.destinations.map((d) => ({ name: typeof d === 'string' ? d : d.name || '' })) : [],
              }));
          })()}
          onBack={() => setStep(2)}
          onNext={handleRoutingNext}
          onLearnCity={handleLearnCity}
        />
      )}
      {step === 4 && (
        <GroupingStep
          suggestions={suggestions}
          vehicles={vehicles}
          drivers={drivers}
          routes={(() => {
            const seen = new Set<string>();
            return operationalRoutes
              .filter(r => r.active !== false)
              .filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; })
              .map(r => ({
                id: r.id,
                name: r.name,
                destinations: Array.isArray(r.destinations) ? r.destinations.map((d) => ({ name: typeof d === 'string' ? d : d.name || '' })) : [],
              }));
          })()}
          executing={executing}
          onBack={() => setStep(3)}
          onExecute={handleExecute}
        />
      )}
      {step === 5 && <ResultsStep results={executionResults} onReset={reset} report={ingestionReport} />}
    </div>
  );
}
