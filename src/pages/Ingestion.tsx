import { useState, useCallback } from 'react';
import { parseNFeXml, parseCsvOrders, parseExcelOrders, ParsedOrderRow } from '@/lib/documentParsers';
import {
  validateNFe, validateOrderRows, generateLoadSuggestions,
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
import { Upload } from 'lucide-react';
import IngestionStepper from '@/components/ingestion/IngestionStepper';
import UploadStep from '@/components/ingestion/UploadStep';
import ValidationStep from '@/components/ingestion/ValidationStep';
import RoutingStep from '@/components/ingestion/RoutingStep';
import type { RouteGroup } from '@/components/ingestion/RoutingStep';
import GroupingStep from '@/components/ingestion/GroupingStep';
import ResultsStep from '@/components/ingestion/ResultsStep';
import { calculateFreight, logFreightCalculation } from '@/hooks/useFreightCalculator';

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
  const [validatedDocs, setValidatedDocs] = useState<ValidatedDocument[]>([]);
  const [validatedOrders, setValidatedOrders] = useState<ValidatedOrder[]>([]);
  const [suggestions, setSuggestions] = useState<LoadSuggestion[]>([]);
  const [routeGroups, setRouteGroups] = useState<RouteGroup[]>([]);
  const [executing, setExecuting] = useState(false);
  const [savingDocsOnly, setSavingDocsOnly] = useState(false);
  const [executionResults, setExecutionResults] = useState<string[]>([]);

  const handleFiles = useCallback(async (fileList: FileList) => {
    const docs: ValidatedDocument[] = [];
    const orderRows: ParsedOrderRow[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const name = file.name.toLowerCase();

      if (name.endsWith('.xml')) {
        try {
          const text = await file.text();
          const parsed = parseNFeXml(text);
          docs.push(validateNFe(parsed, file.name, existingDocs, clients));
        } catch (e: any) {
          docs.push({
            source: { invoiceNumber: '', accessKey: '', items: [] } as any,
            fileName: file.name,
            validations: [{ field: 'parse', message: `Erro ao ler XML: ${e.message}`, severity: 'error' }],
            hasErrors: true, hasWarnings: false,
            matchedClientId: null, matchedClientName: null, isDuplicate: false,
          });
        }
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        orderRows.push(...parseExcelOrders(buffer));
      } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const text = await file.text();
        orderRows.push(...parseCsvOrders(text));
      }
    }

    setValidatedDocs(docs);
    setValidatedOrders(validateOrderRows(orderRows, clients));
    setStep(1);
  }, [existingDocs, clients]);

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

          const freightLabel = freightValue ? ` (frete: R$ ${freightValue.toFixed(2)})` : '';
          results.push(`✅ NF ${doc.source.invoiceNumber} salva${freightLabel}`);
        } catch (e: any) {
          results.push(`❌ NF ${doc.source.invoiceNumber}: ${e.message}`);
        }
      }

      setExecutionResults(results);
      setStep(4);

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
    setStep(2);
  };

  const handleRoutingNext = (groups: RouteGroup[]) => {
    setRouteGroups(groups);
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
    setStep(3);
  };

  const handleExecute = async (assignments: Map<number, { vehicleId: string | null; driverId: string | null }>) => {
    setExecuting(true);
    const results: string[] = [];

    // Track created entities for linking
    const createdDocIds: Map<string, string> = new Map(); // invoiceNumber -> id
    const createdOrderIds: Map<string, string> = new Map(); // orderNumber -> id

    try {
      // 1. Create fiscal documents
      for (const doc of validatedDocs.filter(d => !d.hasErrors && !d.isDuplicate)) {
        try {
          // Calculate freight for this document
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
          });
          createdDocIds.set(doc.source.invoiceNumber, created.id);
          
          // Log freight calculation
          if (freightValue && freightBreakdown?.tableId && currentTenant) {
            await logFreightCalculation(currentTenant.id, created.id, 'fiscal_document', freightBreakdown, user?.id);
          }
          
          const freightLabel = freightValue ? ` (frete: R$ ${freightValue.toFixed(2)})` : ' (sem tabela de frete)';
          results.push(`✅ NF ${doc.source.invoiceNumber} importada${freightLabel}`);
        } catch (e: any) {
          results.push(`❌ NF ${doc.source.invoiceNumber}: ${e.message}`);
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
      setStep(4);

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

      {step === 0 && <UploadStep onFiles={handleFiles} />}
      {step === 1 && (
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
      {step === 2 && (
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
          onBack={() => setStep(1)}
          onNext={handleRoutingNext}
          onLearnCity={handleLearnCity}
        />
      )}
      {step === 3 && (
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
          onBack={() => setStep(2)}
          onExecute={handleExecute}
        />
      )}
      {step === 4 && <ResultsStep results={executionResults} onReset={reset} />}
    </div>
  );
}
