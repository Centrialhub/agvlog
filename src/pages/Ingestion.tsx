import { useState, useCallback } from 'react';
import { parseNFeXml, parseCsvOrders, ParsedNFe, ParsedOrderRow } from '@/lib/documentParsers';
import {
  validateNFe, validateOrderRows, generateLoadSuggestions,
  ValidatedDocument, ValidatedOrder, LoadSuggestion,
} from '@/lib/ingestionValidator';
import { useFiscalDocuments, useCreateFiscalDocument } from '@/hooks/useFiscalDocuments';
import { useClients } from '@/hooks/useClients';
import { useCreateOrder } from '@/hooks/useOrders';
import { useCreateLoad } from '@/hooks/useLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, FileText, CheckCircle, AlertTriangle, XCircle,
  ArrowRight, ArrowLeft, Package, Truck, Loader2, Info,
} from 'lucide-react';

const STEPS = ['Upload', 'Validação', 'Agrupamento', 'Confirmação'] as const;
type Step = typeof STEPS[number];

export default function Ingestion() {
  const { data: existingDocs = [] } = useFiscalDocuments();
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const createDoc = useCreateFiscalDocument();
  const createOrder = useCreateOrder();
  const createLoad = useCreateLoad();
  const { toast } = useToast();

  const [step, setStep] = useState<number>(0);
  const [validatedDocs, setValidatedDocs] = useState<ValidatedDocument[]>([]);
  const [validatedOrders, setValidatedOrders] = useState<ValidatedOrder[]>([]);
  const [suggestions, setSuggestions] = useState<LoadSuggestion[]>([]);
  const [executing, setExecuting] = useState(false);
  const [executionResults, setExecutionResults] = useState<string[]>([]);

  const totalErrors = validatedDocs.filter(d => d.hasErrors).length + validatedOrders.filter(o => o.hasErrors).length;
  const totalWarnings = validatedDocs.filter(d => d.hasWarnings && !d.hasErrors).length + validatedOrders.filter(o => o.hasWarnings && !o.hasErrors).length;
  const totalValid = validatedDocs.filter(d => !d.hasErrors).length + validatedOrders.filter(o => !o.hasErrors).length;

  const handleFiles = useCallback(async (fileList: FileList) => {
    const docs: ValidatedDocument[] = [];
    const orderRows: ParsedOrderRow[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const text = await file.text();

      if (file.name.toLowerCase().endsWith('.xml')) {
        try {
          const parsed = parseNFeXml(text);
          const validated = validateNFe(parsed, file.name, existingDocs, clients);
          docs.push(validated);
        } catch (e: any) {
          docs.push({
            source: { invoiceNumber: '', accessKey: '', items: [] } as any,
            fileName: file.name,
            validations: [{ field: 'parse', message: `Erro ao ler XML: ${e.message}`, severity: 'error' }],
            hasErrors: true,
            hasWarnings: false,
            matchedClientId: null,
            matchedClientName: null,
            isDuplicate: false,
          });
        }
      } else if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt')) {
        const parsed = parseCsvOrders(text);
        orderRows.push(...parsed);
      }
    }

    const validatedOrd = validateOrderRows(orderRows, clients);
    setValidatedDocs(docs);
    setValidatedOrders(validatedOrd);
    setStep(1); // Move to validation step
  }, [existingDocs, clients]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleGenerateSuggestions = () => {
    const s = generateLoadSuggestions(validatedDocs, validatedOrders);
    setSuggestions(s);
    setStep(2);
  };

  const handleExecute = async () => {
    setExecuting(true);
    const results: string[] = [];

    try {
      // 1. Create fiscal documents
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

      // 2. Create orders from CSV
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

      // 3. Create loads from suggestions
      for (const suggestion of suggestions) {
        if (suggestion.totalPallets <= 0) continue;
        try {
          await createLoad.mutateAsync({
            load_number: `ING-${Date.now().toString(36).toUpperCase()}-${suggestion.region.substring(0, 5).toUpperCase()}`,
            destination: suggestion.region,
            total_pallet_count: suggestion.totalPallets,
            total_weight_kg: suggestion.totalWeight,
            status: 'planned',
          } as any);
          results.push(`✅ Carga sugerida para ${suggestion.region} criada`);
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

  const vehiclesWithCapacity = vehicles.filter((v: any) => v.max_pallets > 0) as any[];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Upload className="h-6 w-6 text-primary" /> Importação de Documentos
        </h1>
        <p className="text-sm text-muted-foreground">Upload → Validação → Agrupamento → Execução</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              i === step ? 'bg-primary text-primary-foreground' :
              i < step ? 'bg-primary/20 text-primary' :
              'bg-muted text-muted-foreground'
            }`}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-background/20">{i + 1}</span>
              {s}
            </div>
            {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 0: Upload */}
      {step === 0 && (
        <Card>
          <CardContent className="py-12">
            <div
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = '.xml,.csv,.txt';
                input.onchange = e => {
                  const files = (e.target as HTMLInputElement).files;
                  if (files) handleFiles(files);
                };
                input.click();
              }}
            >
              <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Arraste arquivos ou clique para selecionar</h3>
              <p className="text-sm text-muted-foreground">
                XML (NF-e) • CSV (pedidos) • Múltiplos arquivos permitidos
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Validation */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-success" />
                <div>
                  <div className="text-2xl font-bold text-success">{totalValid}</div>
                  <div className="text-xs text-muted-foreground">Válidos</div>
                </div>
              </CardContent>
            </Card>
            <Card className={totalWarnings > 0 ? 'border-warning/50' : ''}>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-warning" />
                <div>
                  <div className="text-2xl font-bold text-warning">{totalWarnings}</div>
                  <div className="text-xs text-muted-foreground">Avisos</div>
                </div>
              </CardContent>
            </Card>
            <Card className={totalErrors > 0 ? 'border-destructive/50' : ''}>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <XCircle className="h-5 w-5 text-destructive" />
                <div>
                  <div className="text-2xl font-bold text-destructive">{totalErrors}</div>
                  <div className="text-xs text-muted-foreground">Erros (bloqueados)</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* NF-e validation results */}
          {validatedDocs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Notas Fiscais ({validatedDocs.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>NF</TableHead>
                      <TableHead>Destinatário</TableHead>
                      <TableHead>Destino</TableHead>
                      <TableHead>Paletes</TableHead>
                      <TableHead>Peso</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validatedDocs.map((doc, i) => (
                      <TableRow key={i} className={doc.hasErrors ? 'bg-destructive/5' : doc.hasWarnings ? 'bg-warning/5' : ''}>
                        <TableCell className="text-xs font-mono">{doc.fileName}</TableCell>
                        <TableCell className="font-medium">{doc.source.invoiceNumber || '—'}</TableCell>
                        <TableCell className="text-sm">
                          {doc.matchedClientName ? (
                            <span className="text-success">{doc.matchedClientName}</span>
                          ) : (
                            <span className="text-muted-foreground">{doc.source.recipientName || '—'}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {[doc.source.recipientCity, doc.source.recipientState].filter(Boolean).join(', ') || '—'}
                        </TableCell>
                        <TableCell>{doc.source.estimatedPallets || '—'}</TableCell>
                        <TableCell>{doc.source.totalWeight ? `${doc.source.totalWeight} kg` : '—'}</TableCell>
                        <TableCell>{doc.source.totalValue ? `R$ ${doc.source.totalValue.toLocaleString('pt-BR')}` : '—'}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {doc.hasErrors ? (
                              <Badge variant="outline" className="bg-destructive/10 text-destructive text-xs">Erro</Badge>
                            ) : doc.hasWarnings ? (
                              <Badge variant="outline" className="bg-warning/10 text-warning text-xs">Aviso</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-success/10 text-success text-xs">OK</Badge>
                            )}
                            {doc.validations.map((v, vi) => (
                              <div key={vi} className={`text-[10px] flex items-center gap-1 ${
                                v.severity === 'error' ? 'text-destructive' :
                                v.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'
                              }`}>
                                {v.severity === 'error' ? <XCircle className="h-2.5 w-2.5" /> :
                                 v.severity === 'warning' ? <AlertTriangle className="h-2.5 w-2.5" /> :
                                 <Info className="h-2.5 w-2.5" />}
                                {v.message}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* CSV order validation results */}
          {validatedOrders.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="h-4 w-4" /> Pedidos CSV ({validatedOrders.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Destino</TableHead>
                      <TableHead>Qtd</TableHead>
                      <TableHead>Paletes</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validatedOrders.map((order, i) => (
                      <TableRow key={i} className={order.hasErrors ? 'bg-destructive/5' : order.hasWarnings ? 'bg-warning/5' : ''}>
                        <TableCell className="font-medium">{order.source.orderNumber}</TableCell>
                        <TableCell className="text-sm">
                          {order.matchedClientName ? (
                            <span className="text-success">{order.matchedClientName}</span>
                          ) : (
                            <span className="text-muted-foreground">{order.source.clientName || '—'}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{order.source.destination || '—'}</TableCell>
                        <TableCell>{order.source.quantity || '—'}</TableCell>
                        <TableCell>{order.source.palletCount || '—'}</TableCell>
                        <TableCell>
                          {order.hasErrors ? (
                            <Badge variant="outline" className="bg-destructive/10 text-destructive text-xs">Erro</Badge>
                          ) : order.hasWarnings ? (
                            <Badge variant="outline" className="bg-warning/10 text-warning text-xs">Aviso</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-success/10 text-success text-xs">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3 justify-between">
            <Button variant="outline" onClick={reset}><ArrowLeft className="h-4 w-4 mr-2" /> Recomeçar</Button>
            <Button onClick={handleGenerateSuggestions} disabled={totalValid === 0}>
              Gerar Sugestões de Carga <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Grouping / Load suggestions */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Truck className="h-4 w-4" /> Sugestões de Carga por Região
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Região</TableHead>
                    <TableHead>Documentos</TableHead>
                    <TableHead>Pedidos</TableHead>
                    <TableHead>Paletes</TableHead>
                    <TableHead>Peso</TableHead>
                    <TableHead>Paradas</TableHead>
                    <TableHead>Ocupação sugerida</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestions.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma sugestão gerada</TableCell></TableRow>
                  ) : suggestions.map((s, i) => {
                    const bestVehicle = vehiclesWithCapacity.find((v: any) => v.max_pallets >= s.totalPallets);
                    const occupancy = bestVehicle ? Math.round((s.totalPallets / bestVehicle.max_pallets) * 100) : null;
                    const isUnder = occupancy !== null && occupancy < 50;
                    const isOver = !bestVehicle && vehiclesWithCapacity.length > 0;
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{s.region}</TableCell>
                        <TableCell>{s.documents.length}</TableCell>
                        <TableCell>{s.orders.length}</TableCell>
                        <TableCell className="font-medium">{s.totalPallets}</TableCell>
                        <TableCell>{s.totalWeight ? `${s.totalWeight} kg` : '—'}</TableCell>
                        <TableCell>{s.stopCount}</TableCell>
                        <TableCell>
                          {isOver ? (
                            <div className="flex items-center gap-1 text-xs text-destructive">
                              <AlertTriangle className="h-3 w-3" /> Excede todos os veículos
                            </div>
                          ) : occupancy !== null ? (
                            <div className="flex items-center gap-2">
                              <Progress value={occupancy} className={`w-16 h-2 ${isUnder ? '[&>div]:bg-warning' : ''}`} />
                              <span className={`text-xs font-medium ${isUnder ? 'text-warning' : ''}`}>
                                {occupancy}%
                                {isUnder && ' ⚠️ Subutilizado'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">({bestVehicle.plate})</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem veículo configurado</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-between">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
            <Button onClick={handleExecute} disabled={executing || suggestions.length === 0}>
              {executing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executando...</> : <>Confirmar e Executar <CheckCircle className="h-4 w-4 ml-2" /></>}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-success" /> Resultado da Importação
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {executionResults.map((r, i) => (
                  <div key={i} className={`text-sm py-1 ${r.startsWith('✅') ? 'text-success' : 'text-destructive'}`}>{r}</div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-center">
            <Button onClick={reset}><Upload className="h-4 w-4 mr-2" /> Nova Importação</Button>
          </div>
        </div>
      )}
    </div>
  );
}
