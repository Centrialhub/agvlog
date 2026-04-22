import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Upload, AlertTriangle, CheckCircle2, FileText, XCircle, Clock, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseNFeXml } from '@/lib/documentParsers';
import { buildValidationIndexes, validateNFe } from '@/lib/ingestionValidator';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type ReimportPhase = 'idle' | 'ready' | 'clearing' | 'importing' | 'done';

interface ImportError {
  fileName: string;
  message: string;
}

type FileImportState = 'pending' | 'importing' | 'success' | 'error';

interface FileImportStatus {
  fileName: string;
  state: FileImportState;
  invoiceNumber?: string;
  message?: string;
}

const EMPTY_FILE_LIST: File[] = [];

export default function BatchReimportDialog() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: clients = [] } = useClients();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>(EMPTY_FILE_LIST);
  const [phase, setPhase] = useState<ReimportPhase>('idle');
  const [processed, setProcessed] = useState(0);
  const [imported, setImported] = useState(0);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [clearSummary, setClearSummary] = useState<Record<string, number> | null>(null);
  const [erasePreview, setErasePreview] = useState<Record<string, number> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [fileStatuses, setFileStatuses] = useState<FileImportStatus[]>([]);

  const total = files.length;
  const busy = phase === 'clearing' || phase === 'importing';
  const confirmed = confirmationText.trim().toUpperCase() === 'LIMPAR';
  const progress = useMemo(() => {
    if (phase === 'clearing') return 8;
    if (!total) return 0;
    return Math.round((processed / total) * 100);
  }, [phase, processed, total]);

  const setFileStatus = (fileName: string, updates: Partial<FileImportStatus>) => {
    setFileStatuses(prev => prev.map(status => (
      status.fileName === fileName ? { ...status, ...updates } : status
    )));
  };

  const handleFiles = (fileList: FileList | null) => {
    const xmlFiles = Array.from(fileList || []).filter(file => file.name.toLowerCase().endsWith('.xml'));
    setFiles(xmlFiles);
    setFileStatuses(xmlFiles.map(file => ({ fileName: file.name, state: 'pending' })));
    setPhase(xmlFiles.length ? 'ready' : 'idle');
    setProcessed(0);
    setImported(0);
    setErrors([]);
    setClearSummary(null);
  };

  const fetchErasePreview = async () => {
    if (!currentTenant) return;
    setPreviewLoading(true);
    try {
      const tableMap = {
        'Notas fiscais': 'fiscal_documents',
        'Cargas': 'loads',
        'Itens de carga': 'load_items',
        'Viagens': 'dispatch_trips',
        'Paradas': 'dispatch_stops',
        'Eventos': 'dispatch_events',
        'Logs de frete': 'freight_calculation_log',
        'Rascunhos': 'route_planning_drafts',
      } as const;

      const entries = await Promise.all(Object.entries(tableMap).map(async ([label, table]) => {
        const { count } = await supabase
          .from(table as any)
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', currentTenant.id);
        return [label, count || 0] as const;
      }));
      setErasePreview(Object.fromEntries(entries));
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchErasePreview();
  }, [open, currentTenant?.id]);

  const reset = () => {
    setFiles(EMPTY_FILE_LIST);
    setPhase('idle');
    setProcessed(0);
    setImported(0);
    setErrors([]);
    setClearSummary(null);
    setConfirmationText('');
    setFileStatuses([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['fiscal_documents'] }),
      queryClient.invalidateQueries({ queryKey: ['loads'] }),
      queryClient.invalidateQueries({ queryKey: ['pending_docs_count'] }),
      queryClient.invalidateQueries({ queryKey: ['route_planning_drafts'] }),
    ]);
  };

  const startReimport = async () => {
    if (!currentTenant || !files.length || !confirmed) return;
    setPhase('clearing');
    setProcessed(0);
    setImported(0);
    setErrors([]);
    setClearSummary(null);
    setFileStatuses(files.map(file => ({ fileName: file.name, state: 'pending' })));

    try {
      const { data: cleaned, error: cleanError } = await (supabase as any).rpc('clear_reimport_batch_data', {
        _tenant_id: currentTenant.id,
      });
      if (cleanError) throw cleanError;
      setClearSummary((cleaned || {}) as Record<string, number>);

      setPhase('importing');
      const indexes = buildValidationIndexes([], clients);
      let successCount = 0;
      const importErrors: ImportError[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setFileStatus(file.name, { state: 'importing', message: 'Importando...' });
        try {
          const parsed = parseNFeXml(await file.text());
          const validated = validateNFe(parsed, file.name, [], clients, indexes);
          if (validated.hasErrors) {
            throw new Error(validated.validations.filter(v => v.severity === 'error').map(v => v.message).join('; '));
          }

          const { error } = await supabase.from('fiscal_documents').insert({
            tenant_id: currentTenant.id,
            created_by: user?.id,
            document_type: 'inbound',
            invoice_number: validated.source.invoiceNumber,
            access_key: validated.source.accessKey,
            remitter: validated.source.emitterName,
            recipient: validated.source.recipientName,
            recipient_city: validated.source.recipientCity || null,
            recipient_state: validated.source.recipientState || null,
            recipient_neighborhood: validated.source.recipientNeighborhood || null,
            issue_date: validated.source.issueDate || null,
            client_id: validated.matchedClientId,
            product_summary: validated.source.items.map(item => item.description).join(', ').substring(0, 500),
            pallet_count: validated.source.estimatedPallets,
            weight_kg: validated.source.totalWeight,
            value: validated.source.totalValue,
            status: 'confirmed',
          } as any);
          if (error) throw error;
          successCount++;
          setImported(successCount);
          setFileStatus(file.name, {
            state: 'success',
            invoiceNumber: validated.source.invoiceNumber,
            message: `NF ${validated.source.invoiceNumber || 'sem número'} importada`,
          });
        } catch (error: any) {
          const message = error?.message || 'Erro desconhecido ao importar';
          importErrors.push({ fileName: file.name, message });
          setErrors([...importErrors]);
          setFileStatus(file.name, { state: 'error', message });
        } finally {
          setProcessed(i + 1);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      await refreshData();
      setPhase('done');
      toast({
        title: 'Reimportação concluída',
        description: `${successCount} nota(s) importada(s), ${importErrors.length} erro(s).`,
        variant: importErrors.length ? 'default' : undefined,
      });
    } catch (error: any) {
      setPhase('ready');
      toast({ title: 'Erro na reimportação', description: error?.message, variant: 'destructive' });
    }
  };

  const cleanedTotal = clearSummary ? Object.values(clearSummary).reduce((sum, value) => sum + Number(value || 0), 0) : 0;
  const previewTotal = erasePreview ? Object.values(erasePreview).reduce((sum, value) => sum + Number(value || 0), 0) : 0;
  const statusIcon = (state: FileImportState) => {
    if (state === 'success') return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (state === 'error') return <XCircle className="h-4 w-4 text-destructive" />;
    if (state === 'importing') return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const statusLabel: Record<FileImportState, string> = {
    pending: 'Aguardando',
    importing: 'Importando',
    success: 'Sucesso',
    error: 'Erro',
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RotateCcw className="h-4 w-4 mr-1" /> Reimportar notas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reimportação em lote</DialogTitle>
          <DialogDescription>
            Limpa as notas/cargas atuais e importa os XMLs selecionados na sequência.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Esta ação limpa os dados operacionais atuais</AlertTitle>
          <AlertDescription>Notas, cargas, itens, viagens, rascunhos e logs de frete serão removidos antes da nova importação.</AlertDescription>
        </Alert>

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">Será apagado antes da importação</div>
            <Badge variant="destructive">{previewLoading ? 'contando...' : `${previewTotal} registro(s)`}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {Object.entries(erasePreview || {}).map(([label, count]) => (
              <div key={label} className="rounded-md bg-background/70 border border-border p-2">
                <div className="font-semibold text-foreground">{count}</div>
                <div className="text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <label className="block text-xs font-medium text-foreground">
            Digite LIMPAR para liberar a reimportação
            <input
              value={confirmationText}
              onChange={event => setConfirmationText(event.target.value)}
              disabled={busy}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="LIMPAR"
            />
          </label>
        </div>

        <div
          className="rounded-lg border border-dashed border-border p-6 text-center hover:border-primary/50 transition-colors"
          onDragOver={event => event.preventDefault()}
          onDrop={event => { event.preventDefault(); handleFiles(event.dataTransfer.files); }}
        >
          <Upload className="h-9 w-9 mx-auto mb-3 text-muted-foreground" />
          <div className="text-sm font-medium">Selecione ou arraste os XMLs das NF-e</div>
          <div className="text-xs text-muted-foreground mt-1">Somente arquivos .xml serão importados neste fluxo.</div>
          <input ref={inputRef} type="file" multiple accept=".xml" className="hidden" onChange={event => handleFiles(event.target.files)} />
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => inputRef.current?.click()} disabled={busy}>
            Escolher XMLs
          </Button>
        </div>

        {total > 0 && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-primary" /> {total} arquivo(s) selecionado(s)
              </div>
              <Badge variant="outline">{processed}/{total}</Badge>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-muted p-2"><div className="font-semibold text-foreground">{cleanedTotal}</div><div className="text-muted-foreground">limpos</div></div>
              <div className="rounded-md bg-muted p-2"><div className="font-semibold text-success">{imported}</div><div className="text-muted-foreground">importados</div></div>
              <div className="rounded-md bg-muted p-2"><div className="font-semibold text-destructive">{errors.length}</div><div className="text-muted-foreground">erros</div></div>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Resumo</AlertTitle>
            <AlertDescription>{imported} nota(s) importada(s). {errors.length} arquivo(s) com erro.</AlertDescription>
          </Alert>
        )}

        {fileStatuses.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {fileStatuses.map(status => (
              <div key={status.fileName} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    {statusIcon(status.state)}
                    <span className="truncate">{status.fileName}</span>
                  </div>
                  {status.message && <div className="mt-1 text-xs text-muted-foreground">{status.message}</div>}
                </div>
                <Badge variant={status.state === 'error' ? 'destructive' : 'outline'}>{statusLabel[status.state]}</Badge>
              </div>
            ))}
          </div>
        )}

        {errors.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {errors.map((error, index) => (
              <div key={`${error.fileName}-${index}`} className="p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive"><XCircle className="h-4 w-4" /> {error.fileName}</div>
                <div className="text-xs text-muted-foreground mt-1">{error.message}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={reset} disabled={busy}>Limpar seleção</Button>
          <Button onClick={startReimport} disabled={!total || busy || !currentTenant || !confirmed}>
            {phase === 'clearing' ? 'Limpando...' : phase === 'importing' ? 'Importando...' : 'Limpar e importar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}