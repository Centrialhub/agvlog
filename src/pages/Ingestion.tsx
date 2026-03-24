import { useState, useCallback } from 'react';
import { parseNFeXml, parseCsvOrders, parseExcelOrders, ParsedOrderRow } from '@/lib/documentParsers';
import {
  validateNFe, validateOrderRows, generateLoadSuggestions,
  ValidatedDocument, ValidatedOrder, LoadSuggestion,
} from '@/lib/ingestionValidator';
import { useFiscalDocuments, useCreateFiscalDocument } from '@/hooks/useFiscalDocuments';
import { useClients } from '@/hooks/useClients';
import { useCreateOrder } from '@/hooks/useOrders';
import { useCreateLoad } from '@/hooks/useLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { useToast } from '@/hooks/use-toast';
import { Upload } from 'lucide-react';
import IngestionStepper from '@/components/ingestion/IngestionStepper';
import UploadStep from '@/components/ingestion/UploadStep';
import ValidationStep from '@/components/ingestion/ValidationStep';
import GroupingStep from '@/components/ingestion/GroupingStep';
import ResultsStep from '@/components/ingestion/ResultsStep';

// Import drivers hook
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/hooks/useTenant';

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
  const createDoc = useCreateFiscalDocument();
  const createOrder = useCreateOrder();
  const createLoad = useCreateLoad();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [validatedDocs, setValidatedDocs] = useState<ValidatedDocument[]>([]);
  const [validatedOrders, setValidatedOrders] = useState<ValidatedOrder[]>([]);
  const [suggestions, setSuggestions] = useState<LoadSuggestion[]>([]);
  const [executing, setExecuting] = useState(false);
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

  const handleGenerateSuggestions = () => {
    setSuggestions(generateLoadSuggestions(validatedDocs, validatedOrders));
    setStep(2);
  };

  const handleExecute = async (assignments: Map<number, { vehicleId: string | null; driverId: string | null }>) => {
    setExecuting(true);
    const results: string[] = [];

    try {
      for (const doc of validatedDocs.filter(d => !d.hasErrors && !d.isDuplicate)) {
        try {
          await createDoc.mutateAsync({
            document_type: 'inbound',
            invoice_number: doc.source.invoiceNumber,
            access_key: doc.source.accessKey,
            remitter: doc.source.emitterName,
            recipient: doc.source.recipientName,
            issue_date: doc.source.issueDate || null,
            client_id: doc.matchedClientId,
            product_summary: doc.source.items.map(i => i.description).join(', ').substring(0, 500),
            pallet_count: doc.source.estimatedPallets,
            weight_kg: doc.source.totalWeight,
            value: doc.source.totalValue,
            status: 'confirmed',
          });
          results.push(`✅ NF ${doc.source.invoiceNumber} importada`);
        } catch (e: any) {
          results.push(`❌ NF ${doc.source.invoiceNumber}: ${e.message}`);
        }
      }

      for (const order of validatedOrders.filter(o => !o.hasErrors)) {
        try {
          await createOrder.mutateAsync({
            order_number: order.source.orderNumber,
            client_id: order.matchedClientId,
            destination: order.source.destination,
            pallet_count: order.source.palletCount,
            weight_kg: order.source.weightKg,
            quantity: order.source.quantity,
            promised_date: order.source.promisedDate || null,
            status: 'received',
          } as any);
          results.push(`✅ Pedido ${order.source.orderNumber} criado`);
        } catch (e: any) {
          results.push(`❌ Pedido ${order.source.orderNumber}: ${e.message}`);
        }
      }

      for (let idx = 0; idx < suggestions.length; idx++) {
        const suggestion = suggestions[idx];
        if (suggestion.totalPallets <= 0) continue;
        const assignment = assignments.get(idx);
        try {
          await createLoad.mutateAsync({
            load_number: `ING-${Date.now().toString(36).toUpperCase()}-${suggestion.region.substring(0, 5).toUpperCase()}`,
            destination: suggestion.region,
            total_pallet_count: suggestion.totalPallets,
            total_weight_kg: suggestion.totalWeight,
            vehicle_id: assignment?.vehicleId || null,
            driver_id: assignment?.driverId || null,
            status: 'planned',
          } as any);
          results.push(`✅ Carga para ${suggestion.region} criada`);
        } catch (e: any) {
          results.push(`❌ Carga ${suggestion.region}: ${e.message}`);
        }
      }

      setExecutionResults(results);
      setStep(3);
      toast({ title: 'Importação concluída', description: `${results.filter(r => r.startsWith('✅')).length} itens processados` });
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
    setExecutionResults([]);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Upload className="h-6 w-6 text-primary" /> Importação de Documentos
        </h1>
        <p className="text-sm text-muted-foreground">Upload → Validação → Agrupamento → Execução</p>
      </div>

      <IngestionStepper currentStep={step} />

      {step === 0 && <UploadStep onFiles={handleFiles} />}
      {step === 1 && (
        <ValidationStep
          docs={validatedDocs}
          orders={validatedOrders}
          onBack={reset}
          onNext={handleGenerateSuggestions}
        />
      )}
      {step === 2 && (
        <GroupingStep
          suggestions={suggestions}
          vehicles={vehicles as any}
          drivers={drivers as any}
          executing={executing}
          onBack={() => setStep(1)}
          onExecute={handleExecute}
        />
      )}
      {step === 3 && <ResultsStep results={executionResults} onReset={reset} />}
    </div>
  );
}
