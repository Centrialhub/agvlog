import { useState, useCallback } from 'react';
import { parseNFeXml, parseCsvOrders, parseExcelOrders, ParsedOrderRow, ParsedNFe } from '@/lib/documentParsers';
import {
  validateNFe, validateOrderRows, generateLoadSuggestions, buildValidationIndexes,
  ValidatedDocument, ValidatedOrder, LoadSuggestion,
} from '@/lib/ingestionValidator';
import { useFiscalDocuments, useCreateFiscalDocument } from '@/hooks/useFiscalDocuments';
import { useClients } from '@/hooks/useClients';
import { useCreateOrder } from '@/hooks/useOrders';
import { useCreateLoad, useLoads } from '@/hooks/useLoads';
import { useCreateLoadItem } from '@/hooks/useLoadItems';
import { useVehicles } from '@/hooks/useVehicles';
import { useOperationalRoutes, useUpdateOperationalRoute } from '@/hooks/useOperationalRoutes';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, FileStack } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';
import IngestionStepper from '@/components/ingestion/IngestionStepper';
import UploadStep from '@/components/ingestion/UploadStep';
import ORTReviewStep, { OrtReviewDocument } from '@/components/ingestion/ORTReviewStep';
import ValidationStep from '@/components/ingestion/ValidationStep';
import RoutingStep from '@/components/ingestion/RoutingStep';
import type { RouteGroup } from '@/components/ingestion/RoutingStep';
import GroupingStep from '@/components/ingestion/GroupingStep';
import ResultsStep from '@/components/ingestion/ResultsStep';
import { calculateFreight, logFreightCalculation } from '@/hooks/useFreightCalculator';
import { applyOrtFallbacks, isUnknown, UNKNOWN } from '@/lib/ortFieldFallbacks';

import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';

function useDrivers() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('drivers')
        .select('id, name, active')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });
}

export default function Ingestion() {
  const { data: existingDocs = [] } = useFiscalDocuments();
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const { data: drivers = [] } = useDrivers();
  const { data: loads = [] } = useLoads();
  const { data: operationalRoutes = [] } = useOperationalRoutes();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const createDoc = useCreateFiscalDocument();
  const createOrder = useCreateOrder();
  const createLoad = useCreateLoad();
  const createLoadItem = useCreateLoadItem();
  const updateRoute = useUpdateOperationalRoute();
  const { toast } = useToast();

  // Learn city → persist to operational_routes destinations
  const handleLearnCity = useCallback((routeId: string, cityName: string) => {
    const route = operationalRoutes.find(r => r.id === routeId);
    if (!route) return;
    const currentDests: any[] = Array.isArray(route.destinations) ? route.destinations : [];
    const normalizedNew = cityName.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const alreadyExists = currentDests.some((d: any) => {
      const name = typeof d === 'string' ? d : d.name || '';
      return name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() === normalizedNew;
    });
    if (alreadyExists) return;
    const newDests = [...currentDests, { name: cityName }];
    updateRoute.mutate({ id: routeId, destinations: newDests } as any);
    toast({ title: 'Rota atualizada', description: `"${cityName}" adicionada à rota. Próxima vez será automático.` });
  }, [operationalRoutes, updateRoute, toast]);

  const [step, setStep] = useState(0);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [validatedDocs, setValidatedDocs] = useState<ValidatedDocument[]>([]);
  const [validatedOrders, setValidatedOrders] = useState<ValidatedOrder[]>([]);
  const [ortReviewDocs, setOrtReviewDocs] = useState<OrtReviewDocument[]>([]);
  const [suggestions, setSuggestions] = useState<LoadSuggestion[]>([]);
  const [routeGroups, setRouteGroups] = useState<RouteGroup[]>([]);
  const [executing, setExecuting] = useState(false);
  const [savingDocsOnly, setSavingDocsOnly] = useState(false);
  const [ortProcessing, setOrtProcessing] = useState(false);
  const [executionResults, setExecutionResults] = useState<string[]>([]);

  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });

  const normalizeOrtKeyPart = (value: unknown) => String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 48);

  const buildOrtAccessKey = (ort: Pick<OrtReviewDocument, 'invoiceNumber' | 'recipientCnpj' | 'recipientName' | 'recipientCity' | 'issueDate' | 'totalValue'>, fallback: string) => {
    const recipient = normalizeOrtKeyPart(ort.recipientCnpj) || normalizeOrtKeyPart(ort.recipientName);
    const city = normalizeOrtKeyPart(ort.recipientCity);
    const value = Math.round((Number(ort.totalValue) || 0) * 100);
    const parts = [normalizeOrtKeyPart(ort.invoiceNumber) || fallback, recipient, city, normalizeOrtKeyPart(ort.issueDate), value || '0'].filter(Boolean);
    return `ORT-${parts.join('-')}`;
  };

  const toOrtAuditPayload = (ort: OrtReviewDocument) => ({
    invoiceNumber: ort.invoiceNumber,
    issueDate: ort.issueDate,
    paymentTerms: ort.paymentTerms,
    billing: ort.billing,
    cargoDescription: ort.cargoDescription,
    emitterName: ort.emitterName,
    emitterCnpj: ort.emitterCnpj,
    recipientName: ort.recipientName,
    recipientCnpj: ort.recipientCnpj,
    recipientPhone: ort.recipientPhone,
    recipientCity: ort.recipientCity,
    recipientState: ort.recipientState,
    recipientAddress: ort.recipientAddress,
    recipientAddressNumber: ort.recipientAddressNumber,
    recipientZip: ort.recipientZip,
    recipientNeighborhood: ort.recipientNeighborhood,
    totalValue: ort.totalValue,
    totalWeight: ort.totalWeight,
    totalVolume: ort.totalVolume,
    estimatedPallets: ort.estimatedPallets,
    productSummary: ort.productSummary,
    items: ort.items || [],
    pageCount: ort.pageCount || 1,
    sourcePages: ort.sourcePages || [ort.fileName],
  });

  const mapOrtItems = (ort: OrtReviewDocument) => {
    const extractedItems = (ort.items || [])
      .filter(item => item.description?.trim())
      .map(item => ({
        description: item.description.trim(),
        quantity: Number(item.quantity) || 1,
        unit: item.unit || 'UN',
        unitPrice: Number(item.unitPrice) || (Number(item.totalPrice) || 0),
        totalPrice: Number(item.totalPrice) || Number(item.unitPrice) || 0,
        ncm: '',
        cfop: '',
      }));

    return extractedItems.length > 0
      ? extractedItems
      : [{ description: ort.productSummary || 'Mercadoria ORT', quantity: 1, unit: 'UN', unitPrice: ort.totalValue || 0, totalPrice: ort.totalValue || 0, ncm: '', cfop: '' }];
  };

  const getChangedOrtFields = (ort: OrtReviewDocument) => {
    const extracted = ort.extractedPayload || {};
    const reviewed = toOrtAuditPayload(ort);
    return Object.keys(reviewed).filter(key => String((extracted as any)[key] ?? '') !== String((reviewed as any)[key] ?? ''));
  };

  const recordOrtAudit = async (doc: ValidatedDocument, fiscalDocumentId: string | null, status = 'saved') => {
    if (!currentTenant || !user || doc.source.series !== 'ORT') return;
    const ort = ortReviewDocs.find((candidate, idx) => buildOrtAccessKey(candidate, `DOC${idx + 1}`) === doc.source.accessKey);
    if (!ort) return;
    const { error } = await supabase.from('ort_extraction_audits' as any).insert({
      tenant_id: currentTenant.id,
      fiscal_document_id: fiscalDocumentId,
      source_file_name: ort.fileName,
      ort_number: ort.invoiceNumber || null,
      dedupe_key: doc.source.accessKey,
      extracted_payload: ort.extractedPayload || toOrtAuditPayload(ort),
      reviewed_payload: toOrtAuditPayload(ort),
      field_confidences: ort.fieldConfidences || {},
      overall_confidence: Math.max(0, Math.min(1, Number(ort.confidence) || 0)),
      needs_review: Boolean(ort.needsReview) || Number(ort.confidence) < 0.82,
      reviewed: true,
      changed_fields: getChangedOrtFields(ort),
      status,
      created_by: user.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    });
    if (error) throw error;
  };

  const dedupeOrtReviewDocs = (docs: OrtReviewDocument[]) => {
    const existingAccessKeys = new Set(existingDocs.map(d => d.access_key).filter(Boolean));
    const existingInvoiceNumbers = new Set(existingDocs.map(d => d.invoice_number).filter(Boolean));

    // Build a unified-doc key. Priority: ORT number, then CNPJ, then normalized name+address+city.
    const unifiedKeyFor = (doc: OrtReviewDocument): string => {
      const ortNum = normalizeOrtKeyPart(doc.invoiceNumber);
      if (ortNum) return `ORT#${ortNum}`;
      const cnpj = normalizeOrtKeyPart(doc.recipientCnpj);
      const addr = normalizeOrtKeyPart(`${doc.recipientAddress}${doc.recipientAddressNumber}`);
      const city = normalizeOrtKeyPart(doc.recipientCity);
      const name = normalizeOrtKeyPart(doc.recipientName);
      if (cnpj && (addr || city)) return `CNPJ#${cnpj}#${city}#${addr}`;
      if (cnpj) return `CNPJ#${cnpj}`;
      if (name && addr && city) return `NAME#${name}#${city}#${addr}`;
      return `RAW#${doc.fileName}#${Math.random()}`;
    };

    const merged = new Map<string, OrtReviewDocument>();
    let batchDuplicates = 0;
    let mergedScans = 0;

    docs.forEach(doc => {
      const key = unifiedKeyFor(doc);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...doc, unifiedDocId: key, mergedFrom: 1 });
        return;
      }
      // Merge: sum totals, dedupe items by description, append source pages
      mergedScans += 1;
      type ItemLite = NonNullable<OrtReviewDocument['items']>[number];
      const itemMap = new Map<string, ItemLite>();
      const pushItem = (it: ItemLite) => {
        const k = (it.description || '').trim().toLowerCase();
        if (!k) return;
        const cur = itemMap.get(k);
        if (cur) {
          cur.quantity = (cur.quantity || 0) + (it.quantity || 0);
          cur.totalPrice = (cur.totalPrice || 0) + (it.totalPrice || 0);
          cur.weightKg = (cur.weightKg || 0) + (it.weightKg || 0);
          cur.volumeM3 = (cur.volumeM3 || 0) + (it.volumeM3 || 0);
        } else {
          itemMap.set(k, { ...it });
        }
      };
      (existing.items || []).forEach(pushItem);
      (doc.items || []).forEach(pushItem);

      const pages = Array.from(new Set([...(existing.sourcePages || []), ...(doc.sourcePages || [])]));
      merged.set(key, {
        ...existing,
        // Prefer non-empty values from either side
        invoiceNumber: existing.invoiceNumber || doc.invoiceNumber,
        issueDate: existing.issueDate || doc.issueDate,
        paymentTerms: existing.paymentTerms || doc.paymentTerms,
        billing: existing.billing || doc.billing,
        cargoDescription: existing.cargoDescription || doc.cargoDescription,
        recipientPhone: existing.recipientPhone || doc.recipientPhone,
        recipientAddress: existing.recipientAddress || doc.recipientAddress,
        recipientAddressNumber: existing.recipientAddressNumber || doc.recipientAddressNumber,
        recipientZip: existing.recipientZip || doc.recipientZip,
        recipientNeighborhood: existing.recipientNeighborhood || doc.recipientNeighborhood,
        totalValue: (existing.totalValue || 0) + (doc.totalValue || 0),
        totalWeight: (existing.totalWeight || 0) + (doc.totalWeight || 0),
        totalVolume: (existing.totalVolume || 0) + (doc.totalVolume || 0),
        estimatedPallets: Math.max(1, (existing.estimatedPallets || 0) + (doc.estimatedPallets || 0)),
        items: Array.from(itemMap.values()),
        sourcePages: pages,
        pageCount: pages.length || (existing.pageCount || 1) + (doc.pageCount || 1),
        confidence: Math.min(existing.confidence || 0, doc.confidence || 0),
        needsReview: existing.needsReview || doc.needsReview,
        mergedFrom: (existing.mergedFrom || 1) + 1,
      });
    });

    // Filter out documents already saved in DB (by access key or invoice number)
    let existingDuplicates = 0;
    const uniqueDocs: OrtReviewDocument[] = [];
    Array.from(merged.values()).forEach((doc, index) => {
      const key = buildOrtAccessKey(doc, `DOC${index + 1}`);
      const legacyKey = `ORT-${doc.invoiceNumber || index + 1}`;
      const invoiceNumber = doc.invoiceNumber || '';
      if (existingAccessKeys.has(key) || existingAccessKeys.has(legacyKey) || (invoiceNumber && existingInvoiceNumbers.has(invoiceNumber))) {
        existingDuplicates += 1;
        return;
      }
      uniqueDocs.push({ ...doc, extractedPayload: toOrtAuditPayload(doc) });
    });

    return { uniqueDocs, batchDuplicates: mergedScans, existingDuplicates };
  };

  const handleFiles = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList);
    const t0 = performance.now();

    // Read ALL files in parallel (I/O bound) — huge speedup vs sequential await
    const fileBuffers = await Promise.all(
      files.map(async (file) => {
        const name = file.name.toLowerCase();
        try {
          if (name.endsWith('.xml') || name.endsWith('.csv') || name.endsWith('.txt')) {
            return { file, name, kind: name.endsWith('.xml') ? 'xml' : 'csv', text: await file.text(), buffer: null as ArrayBuffer | null };
          }
          if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            return { file, name, kind: 'excel' as const, text: '', buffer: await file.arrayBuffer() };
          }
          return { file, name, kind: 'unknown' as const, text: '', buffer: null };
        } catch (e: any) {
          return { file, name, kind: 'error' as const, text: '', buffer: null, error: e?.message || 'Erro de leitura' };
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
          docs.push(validateNFe(parsed, fb.file.name, existingDocs, clients, indexes));
        } catch (e: any) {
          docs.push({
            source: { invoiceNumber: '', accessKey: '', items: [] } as any,
            fileName: fb.file.name,
            validations: [{ field: 'parse', message: `Erro ao ler XML: ${e.message}`, severity: 'error' }],
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
          source: { invoiceNumber: '', accessKey: '', items: [] } as any,
          fileName: fb.file.name,
          validations: [{ field: 'parse', message: `Erro ao ler arquivo: ${(fb as any).error}`, severity: 'error' }],
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
    setOrtProcessing(true);
    try {
      const payload = await Promise.all(files.map(async file => ({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      })));

      const { data, error } = await supabase.functions.invoke('extract-ort', { body: { files: payload } });
      if (error) throw error;

      const docs: OrtReviewDocument[] = ((data as any)?.documents || []).map((ort: any, idx: number) => {
        const reviewDoc: OrtReviewDocument = {
          invoiceNumber: ort.invoiceNumber || `ORT-${Date.now()}-${idx + 1}`,
          issueDate: ort.issueDate || new Date().toISOString().substring(0, 10),
          paymentTerms: ort.paymentTerms || '',
          billing: ort.billing || '',
          cargoDescription: ort.cargoDescription || '',
          emitterName: ort.emitterName || 'ORT',
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
          totalValue: Number(ort.totalValue) || 0,
          totalWeight: Number(ort.totalWeight) || 0,
          totalVolume: Number(ort.totalVolume) || 0,
          estimatedPallets: Math.max(1, Number(ort.estimatedPallets) || Math.ceil((Number(ort.totalWeight) || 0) / 800) || 1),
          productSummary: ort.productSummary || 'Mercadoria ORT',
          items: Array.isArray(ort.items) ? ort.items.map((item: any) => ({
            description: item.description || '',
            quantity: Number(item.quantity) || 1,
            unit: item.unit || 'UN',
            unitPrice: Number(item.unitPrice) || 0,
            totalPrice: Number(item.totalPrice) || 0,
            weightKg: Number(item.weightKg) || 0,
            volumeM3: Number(item.volumeM3) || 0,
            confidence: Number(item.confidence) || Number(ort.confidence) || 0,
          })).filter((item: any) => item.description) : [],
          confidence: Number(ort.confidence) || 0,
          needsReview: Boolean(ort.needsReview) || Number(ort.confidence) < 0.82,
          fieldConfidences: ort.fieldConfidences || {},
          fileName: ort.sourceFileName || files[idx]?.name || `ORT ${idx + 1}`,
          sourcePages: Array.isArray(ort.sourcePages) && ort.sourcePages.length
            ? ort.sourcePages
            : [ort.sourceFileName || files[idx]?.name || `ORT ${idx + 1}`],
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

      const { uniqueDocs, batchDuplicates, existingDuplicates } = dedupeOrtReviewDocs(docs);

      if (uniqueDocs.length === 0) {
        toast({ title: 'Nenhuma ORT nova encontrada', description: 'Todas as ORTs enviadas já estavam duplicadas.', variant: 'destructive' });
        return;
      }

      setOrtReviewDocs(uniqueDocs);
      setValidatedOrders([]);
      setStep(1);
      const parts: string[] = [];
      if (batchDuplicates) parts.push(`${batchDuplicates} scan(s) unificado(s) ao mesmo cliente`);
      if (existingDuplicates) parts.push(`${existingDuplicates} já existente(s) no sistema ignorada(s)`);
      const dedupeText = parts.length ? ` ${parts.join('; ')}.` : '';
      toast({ title: 'ORTs processadas', description: `${uniqueDocs.length} documento(s) NF-like pronto(s) para revisão.${dedupeText}` });
    } catch (e: any) {
      toast({ title: 'Erro ao ler ORT', description: e.message, variant: 'destructive' });
    } finally {
      setOrtProcessing(false);
    }
  }, [existingDocs, toast]);

  const handleUpdateOrtReviewDoc = useCallback((index: number, updates: Partial<OrtReviewDocument>) => {
    setOrtReviewDocs(prev => prev.map((doc, i) => i === index ? { ...doc, ...updates, needsReview: false } : doc));
  }, []);

  const handleConfirmOrtReview = useCallback(() => {
    const indexes = buildValidationIndexes(existingDocs, clients);
    const seenReviewKeys = new Set<string>();
    const docs = ortReviewDocs.map((ort, idx) => {
      const accessKey = buildOrtAccessKey(ort, `DOC${idx + 1}`);
      const parsed: ParsedNFe = {
        invoiceNumber: ort.invoiceNumber,
        series: 'ORT',
        accessKey,
        issueDate: ort.issueDate,
        emitterName: ort.emitterName,
        emitterCnpj: ort.emitterCnpj,
        recipientName: ort.recipientName,
        recipientCnpj: ort.recipientCnpj,
        recipientCity: ort.recipientCity,
        recipientState: ort.recipientState,
        recipientAddress: ort.recipientAddress,
        recipientNeighborhood: ort.recipientNeighborhood,
        items: mapOrtItems(ort),
        totalValue: ort.totalValue || 0,
        totalWeight: ort.totalWeight || 0,
        totalVolume: ort.totalVolume || 0,
        estimatedPallets: Math.max(1, ort.estimatedPallets || 1),
      };
      const validated = validateNFe(parsed, `ORT ${ort.fileName}`, existingDocs, clients, indexes);
      if (seenReviewKeys.has(accessKey)) {
        validated.validations.push({ field: 'accessKey', message: 'ORT duplicada neste lote de importação', severity: 'error' });
        validated.hasErrors = true;
        validated.isDuplicate = true;
      }
      seenReviewKeys.add(accessKey);
      if (ort.needsReview || ort.confidence < 0.82) {
        validated.validations.push({ field: 'ortConfidence', message: 'ORT tinha campos de baixa confiança — revisão manual realizada', severity: 'info' });
      }
      return validated;
    });
    setValidatedDocs(docs);
    setValidatedOrders([]);
    setStep(2);
  }, [clients, existingDocs, ortReviewDocs]);

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
    const results: string[] = [];
    try {
      for (const doc of validatedDocs.filter(d => !d.hasErrors && !d.isDuplicate)) {
        const savedId = (doc as any)._savedId;
        try {
          if (savedId) {
            // Already saved on upload — just link to load if needed
            if (loadId) {
              await supabase.from('fiscal_documents').update({ load_id: loadId } as any).eq('id', savedId);
            }
            results.push(`✅ NF ${doc.source.invoiceNumber} ${loadId ? 'vinculada à carga' : '(já salva)'}`);
          } else {
            let freightValue: number | null = null;
            let freightBreakdown: any = {};
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
              access_key: doc.source.accessKey,
              remitter: doc.source.emitterName,
              recipient: doc.source.recipientName,
              recipient_city: doc.source.recipientCity || null,
              recipient_state: doc.source.recipientState || null,
              recipient_neighborhood: doc.source.recipientNeighborhood || null,
              issue_date: doc.source.issueDate || null,
              client_id: doc.matchedClientId,
              product_summary: doc.source.items.map(i => i.description).join(', ').substring(0, 500),
              pallet_count: doc.source.estimatedPallets,
              weight_kg: doc.source.totalWeight,
              value: doc.source.totalValue,
              freight_value: freightValue,
              freight_breakdown: freightBreakdown,
              freight_table_id: freightTableId,
              status: 'confirmed',
              load_id: loadId || null,
            });

            if (freightValue && freightBreakdown?.tableId && currentTenant) {
              await logFreightCalculation(currentTenant.id, created.id, 'fiscal_document', freightBreakdown, user?.id);
            }

            await recordOrtAudit(doc, created.id, loadId ? 'saved_and_linked' : 'saved');

            const freightLabel = freightValue ? ` (frete: R$ ${freightValue.toFixed(2)})` : '';
            results.push(`✅ NF ${doc.source.invoiceNumber} salva${freightLabel}`);
          }
        } catch (e: any) {
          results.push(`❌ NF ${doc.source.invoiceNumber}: ${e.message}`);
        }
      }

      setExecutionResults(results);
      setStep(5);

      const successCount = results.filter(r => r.startsWith('✅')).length;
      const loadLabel = loadId ? loads.find(l => l.id === loadId)?.load_number : null;
      toast({
        title: 'NF-es salvas',
        description: loadLabel
          ? `${successCount} documentos vinculados à carga ${loadLabel}.`
          : `${successCount} documentos salvos. Agrupe em cargas quando quiser na página de Cargas.`,
      });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally {
      setSavingDocsOnly(false);
    }
  };

  const handleGoToRouting = () => {
    setStep(3);
  };

  const handleRoutingNext = async (groups: RouteGroup[]) => {
    setRouteGroups(groups);

    // ── Auto-save valid docs to DB at grouping step so nothing is lost ──
    const validDocs = validatedDocs.filter(d => !d.hasErrors && !d.isDuplicate && !(d as any)._savedId);
    let savedCount = 0;
    for (const doc of validDocs) {
      try {
        let freightValue: number | null = null;
        let freightBreakdown: any = {};
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
          access_key: doc.source.accessKey,
          remitter: doc.source.emitterName,
          recipient: doc.source.recipientName,
          recipient_city: doc.source.recipientCity || null,
          recipient_state: doc.source.recipientState || null,
          recipient_neighborhood: doc.source.recipientNeighborhood || null,
          issue_date: doc.source.issueDate || null,
          product_summary: doc.source.items.map(i => i.description).join(', ').substring(0, 500),
          pallet_count: doc.source.estimatedPallets,
          weight_kg: doc.source.totalWeight,
          value: doc.source.totalValue,
          freight_value: freightValue,
          freight_breakdown: freightBreakdown,
          freight_table_id: freightTableId,
          status: 'confirmed',
        });

        (doc as any)._savedId = created.id;

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
    setExecuting(true);
    const results: string[] = [];

    // Track created entities for linking
    const createdDocIds: Map<string, string> = new Map(); // invoiceNumber -> id
    const createdOrderIds: Map<string, string> = new Map(); // orderNumber -> id

    try {
      // 1. Map fiscal documents (already saved on upload)
      for (const doc of validatedDocs.filter(d => !d.hasErrors && !d.isDuplicate)) {
        const savedId = (doc as any)._savedId;
        if (savedId) {
          createdDocIds.set(doc.source.invoiceNumber, savedId);
          results.push(`✅ NF ${doc.source.invoiceNumber} (já salva)`);
        } else {
          // Fallback: save now if somehow not saved earlier
          try {
            let freightValue: number | null = null;
            let freightBreakdown: any = {};
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
              access_key: doc.source.accessKey,
              remitter: doc.source.emitterName,
              recipient: doc.source.recipientName,
              recipient_city: doc.source.recipientCity || null,
              recipient_state: doc.source.recipientState || null,
              recipient_neighborhood: doc.source.recipientNeighborhood || null,
              issue_date: doc.source.issueDate || null,
              product_summary: doc.source.items.map(i => i.description).join(', ').substring(0, 500),
              pallet_count: doc.source.estimatedPallets,
              weight_kg: doc.source.totalWeight,
              value: doc.source.totalValue,
              freight_value: freightValue,
              freight_breakdown: freightBreakdown,
              freight_table_id: freightTableId,
              status: 'confirmed',
            });
            createdDocIds.set(doc.source.invoiceNumber, created.id);

            if (freightValue && freightBreakdown?.tableId && currentTenant) {
              await logFreightCalculation(currentTenant.id, created.id, 'fiscal_document', freightBreakdown, user?.id);
            }

            await recordOrtAudit(doc, created.id, 'imported_on_execute');

            const freightLabel = freightValue ? ` (frete: R$ ${freightValue.toFixed(2)})` : ' (sem tabela de frete)';
            results.push(`✅ NF ${doc.source.invoiceNumber} importada${freightLabel}`);
          } catch (e: any) {
            results.push(`❌ NF ${doc.source.invoiceNumber}: ${e.message}`);
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
          } as any);
          createdOrderIds.set(order.source.orderNumber, created.id);
          results.push(`✅ Pedido ${order.source.orderNumber} criado`);
        } catch (e: any) {
          results.push(`❌ Pedido ${order.source.orderNumber}: ${e.message}`);
        }
      }

      // 3. Create loads WITH load_items linked to documents/orders
      for (let idx = 0; idx < suggestions.length; idx++) {
        const suggestion = suggestions[idx];
        if (suggestion.totalPallets <= 0) continue;
        const assignment = assignments.get(idx);
        try {
          const loadNumber = `ING-${Date.now().toString(36).toUpperCase()}-${suggestion.region.substring(0, 5).toUpperCase()}`;
          const createdLoad = await createLoad.mutateAsync({
            load_number: loadNumber,
            destination: suggestion.region,
            vehicle_id: assignment?.vehicleId || null,
            driver_id: assignment?.driverId || null,
            status: 'planned',
          } as any);

          const loadId = createdLoad.id;
          let itemsCreated = 0;

          // Create load_items from documents
          for (const doc of suggestion.documents) {
            const docId = createdDocIds.get(doc.source.invoiceNumber);
            try {
              await createLoadItem.mutateAsync({
                load_id: loadId,
                fiscal_document_id: docId || null,
                item_description: `NF ${doc.source.invoiceNumber} - ${doc.source.recipientName || 'Sem dest.'}`,
                quantity: doc.source.items.reduce((s, item) => s + item.quantity, 0),
                pallet_count: doc.source.estimatedPallets,
                weight_kg: doc.source.totalWeight,
                volume_m3: doc.source.totalVolume || 0,
              } as any);
              itemsCreated++;
            } catch {
              // Continue on item creation failure
            }
          }

          // Create load_items from orders
          for (const order of suggestion.orders) {
            const orderId = createdOrderIds.get(order.source.orderNumber);
            try {
              await createLoadItem.mutateAsync({
                load_id: loadId,
                order_id: orderId || null,
                item_description: `Pedido ${order.source.orderNumber} - ${order.source.clientName || 'Sem cliente'}`,
                quantity: order.source.quantity || 0,
                pallet_count: order.source.palletCount || Math.ceil((order.source.quantity || 0) / 50),
                weight_kg: order.source.weightKg || 0,
              } as any);
              itemsCreated++;
            } catch {
              // Continue
            }
          }

          // Link fiscal documents to load
          for (const doc of suggestion.documents) {
            const docId = createdDocIds.get(doc.source.invoiceNumber);
            if (docId) {
              try {
                await supabase.from('fiscal_documents').update({ load_id: loadId } as any).eq('id', docId);
              } catch {
                // Non-critical
              }
            }
          }

          results.push(`✅ Carga ${loadNumber} → ${suggestion.region} (${itemsCreated} itens vinculados)`);
        } catch (e: any) {
          results.push(`❌ Carga ${suggestion.region}: ${e.message}`);
        }
      }

      setExecutionResults(results);
      setStep(5);

      const successCount = results.filter(r => r.startsWith('✅')).length;
      const errorCount = results.filter(r => r.startsWith('❌')).length;

      toast({
        title: 'Importação concluída',
        description: `${successCount} sucesso${errorCount > 0 ? `, ${errorCount} erros` : ''}`,
        variant: errorCount > 0 ? 'destructive' : 'default',
      });
    } catch (e: any) {
      toast({ title: 'Erro na execução', description: e.message, variant: 'destructive' });
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
    setRouteGroups([]);
    setExecutionResults([]);
  };

  return (
    <div className="animate-fade-in space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Upload className="h-5 w-5 text-primary" /> Importação
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Upload → Validação → Roteirização → Agrupamento → Execução</p>
      </div>

      <IngestionStepper currentStep={step} />

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
        />
      )}
      {step === 2 && (
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
                destinations: Array.isArray(r.destinations) ? r.destinations.map((d: any) => ({ name: typeof d === 'string' ? d : d.name || '' })) : [],
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
          vehicles={vehicles as any}
          drivers={drivers as any}
          routes={(() => {
            const seen = new Set<string>();
            return operationalRoutes
              .filter(r => r.active !== false)
              .filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; })
              .map(r => ({
                id: r.id,
                name: r.name,
                destinations: Array.isArray(r.destinations) ? r.destinations.map((d: any) => ({ name: typeof d === 'string' ? d : d.name || '' })) : [],
              }));
          })()}
          executing={executing}
          onBack={() => setStep(3)}
          onExecute={handleExecute}
        />
      )}
      {step === 5 && <ResultsStep results={executionResults} onReset={reset} />}
    </div>
  );
}
