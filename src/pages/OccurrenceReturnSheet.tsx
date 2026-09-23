import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useIsAdmin } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { ArrowLeft, Download, Printer, FileText, XCircle, RefreshCw } from 'lucide-react';
import {
  useReturnSheetsForOccurrence,
  useGenerateReturnSheet,
  useCancelReturnSheet,
  useMarkReturnSheetPrinted,
  useUploadSignedProof,
  useReturnSheetHistory,
  canGenerateReturnSheet,
  getSignedProofUrl,
  partitionReturnSheets,
  type ReturnSheet,
} from '@/hooks/useOccurrenceReturnSheet';
import { OccurrenceReturnSheetPreview } from '@/components/occurrences/OccurrenceReturnSheetPreview';
import { downloadReturnSheetPdf, openReturnSheetPdfPrint } from '@/lib/occurrences/occurrenceReturnSheetPdf';

const sheetCompanyName = (sheet: ReturnSheet): string | undefined => {
  const name = sheet.company_snapshot.name;
  return typeof name === 'string' ? name : undefined;
};

export default function OccurrenceReturnSheetPage() {
  const toast = useSonnerToast();
  const { id: occurrenceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();

  const occurrenceQuery = useQuery({
    queryKey: ['delivery-occurrence-detail', currentTenant?.id, occurrenceId],
    enabled: !!occurrenceId && !!currentTenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_occurrences')
        .select('*')
        .eq('id', occurrenceId!)
        .eq('tenant_id', currentTenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const occurrence = occurrenceQuery.data;

  const sheetsQuery = useReturnSheetsForOccurrence(occurrenceId);
  const { activeSheet, displaySheet, historicalSheets } = useMemo(
    () => partitionReturnSheets(sheetsQuery.data ?? []),
    [sheetsQuery.data],
  );

  const generateMut = useGenerateReturnSheet();
  const cancelMut = useCancelReturnSheet();
  const printMut = useMarkReturnSheetPrinted();
  const uploadMut = useUploadSignedProof();

  const [cancelReason, setCancelReason] = useState('');
  const [regenReason, setRegenReason] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');

  useEffect(() => {
    setReceiverName('');
    setReceiverDoc('');
  }, [activeSheet?.id, occurrenceId, currentTenant?.id]);

  const generation = canGenerateReturnSheet(occurrence);

  const handleGenerate = async (regenerate = false) => {
    if (!occurrenceId) return;
    try {
      await generateMut.mutateAsync({
        occurrenceId,
        regenerate,
        reason: regenerate ? regenReason : null,
      });
      toast.success('Folha gerada');
      setRegenReason('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleCancel = async () => {
    if (!activeSheet) return;
    if (!cancelReason.trim()) { toast.error('Informe o motivo'); return; }
    try {
      await cancelMut.mutateAsync({ returnSheetId: activeSheet.id, reason: cancelReason });
      toast.success('Folha cancelada');
      setCancelReason('');
    } catch (err) { toast.error((err as Error).message); }
  };

  const handleUpload = async (file: File) => {
    if (!activeSheet) return;
    try {
      await uploadMut.mutateAsync({
        returnSheetId: activeSheet.id,
        file,
        receiverName: receiverName || null,
        receiverDocument: receiverDoc || null,
      });
      toast.success('Folha assinada anexada');
      setReceiverName('');
      setReceiverDoc('');
    } catch (err) { toast.error((err as Error).message); }
  };

  const openSignedReturnSheet = async (path: string) => {
    const popup = window.open('', '_blank');
    if (!popup) {
      toast.error('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente novamente.');
      return;
    }
    popup.opener = null;
    try {
      const url = await getSignedProofUrl(path);
      if (!url) throw new Error('Não foi possível gerar o link temporário da folha assinada.');
      popup.location.href = url;
    } catch (error) {
      popup.close();
      toast.error(error instanceof Error ? error.message : 'Não foi possível abrir a folha assinada.');
    }
  };

  const historyQuery = useReturnSheetHistory(displaySheet?.id);

  if (occurrenceQuery.isLoading || sheetsQuery.isLoading) return <div className="p-6">Carregando...</div>;
  if (occurrenceQuery.isError || sheetsQuery.isError) {
    const queryError = occurrenceQuery.error || sheetsQuery.error;
    return (
      <div className="container mx-auto p-4 md:p-6 max-w-6xl">
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar a folha de devolução</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{queryError instanceof Error ? queryError.message : 'Falha ao consultar ocorrência ou versões da folha.'}</p>
            <Button variant="outline" size="sm" onClick={() => void Promise.all([occurrenceQuery.refetch(), sheetsQuery.refetch()])}>Tentar novamente</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!occurrence) return <div className="p-6">Ocorrência não encontrada</div>;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-6xl space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <h1 className="text-xl font-semibold">Folha de Devolução</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex justify-between items-center">
            <span>Ocorrência {occurrence.occurrence_number || occurrence.id.slice(0, 8)}</span>
            <Badge variant={['resolved','closed'].includes(occurrence.status) ? 'default' : 'secondary'}>
              {occurrence.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
          <div><b>Tipo:</b> {occurrence.occurrence_type}</div>
          <div><b>NF:</b> {occurrence.invoice_number || '—'}</div>
          <div><b>Cliente:</b> {occurrence.customer_name || '—'}</div>
          <div><b>Fornecedor:</b> {occurrence.supplier_name || '—'}</div>
          <div><b>Cidade:</b> {occurrence.city || '—'}</div>
          <div><b>Solução:</b> {occurrence.resolution_type || '—'}</div>
        </CardContent>
      </Card>

      {!generation.ok && !activeSheet && (
        <Alert>
          <AlertTitle>Folha indisponível</AlertTitle>
          <AlertDescription>{generation.reason}</AlertDescription>
        </Alert>
      )}

      {generation.ok && !activeSheet && (
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm">
              A ocorrência está finalizada. Você pode gerar a folha para devolução.
            </div>
            <Button onClick={() => handleGenerate(false)} disabled={generateMut.isPending}>
              <FileText className="w-4 h-4 mr-1" /> Gerar Folha de Devolução
            </Button>
          </CardContent>
        </Card>
      )}

      {displaySheet && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Folha {displaySheet.sheet_number}</span>
                <Badge>{displaySheet.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadReturnSheetPdf(displaySheet, sheetCompanyName(displaySheet))}>
                  <Download className="w-4 h-4 mr-1" /> Baixar PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => openReturnSheetPdfPrint(displaySheet, sheetCompanyName(displaySheet))}>
                  <Printer className="w-4 h-4 mr-1" /> Imprimir
                </Button>
                {displaySheet.status === 'generated' && (
                  <Button size="sm" variant="outline" onClick={() => printMut.mutate(displaySheet.id)}>
                    Marcar como impressa
                  </Button>
                )}
                {displaySheet.signed_proof_url && (
                  <Button size="sm" variant="outline" onClick={() => void openSignedReturnSheet(displaySheet.signed_proof_url!)}>
                    Ver folha assinada
                  </Button>
                )}
              </div>

              {['generated', 'printed'].includes(displaySheet.status) && (
                <div className="border rounded p-3 space-y-2">
                  <div className="font-medium text-sm">Anexar folha assinada</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Nome do recebedor</Label>
                      <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
                    </div>
                    <div>
                      <Label>Documento</Label>
                      <Input value={receiverDoc} onChange={(e) => setReceiverDoc(e.target.value)} />
                    </div>
                  </div>
                  <Input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                    disabled={uploadMut.isPending}
                  />
                </div>
              )}

              {activeSheet?.id === displaySheet.id && displaySheet.status !== 'cancelled' && (
                <details className="border rounded p-3">
                  <summary className="text-sm cursor-pointer">Regerar / Cancelar folha</summary>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Motivo para regerar (nova versão)</Label>
                      <Textarea value={regenReason} onChange={(e) => setRegenReason(e.target.value)} rows={2} />
                      <Button size="sm" className="mt-2" onClick={() => handleGenerate(true)} disabled={!regenReason.trim() || generateMut.isPending}>
                        <RefreshCw className="w-4 h-4 mr-1" /> Regerar (nova versão)
                      </Button>
                    </div>
                    {(isAdmin) && (
                      <div>
                        <Label>Motivo do cancelamento</Label>
                        <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} />
                        <Button size="sm" variant="destructive" className="mt-2" onClick={handleCancel} disabled={!cancelReason.trim() || cancelMut.isPending}>
                          <XCircle className="w-4 h-4 mr-1" /> Cancelar folha
                        </Button>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          <OccurrenceReturnSheetPreview sheet={displaySheet} />

          {historyQuery.isError && (
            <Alert variant="destructive">
              <AlertTitle>Histórico indisponível</AlertTitle>
              <AlertDescription>
                {historyQuery.error instanceof Error ? historyQuery.error.message : 'Falha ao consultar o histórico.'}
                <Button variant="link" onClick={() => void historyQuery.refetch()}>Tentar novamente</Button>
              </AlertDescription>
            </Alert>
          )}

          {!historyQuery.isError && (historyQuery.data ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                {(historyQuery.data ?? []).map((h) => (
                  <div key={h.id} className="flex justify-between border-b py-1">
                    <span>{h.action}{h.reason ? ` — ${h.reason}` : ''}</span>
                    <span className="text-muted-foreground">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {historicalSheets.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Versões anteriores</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {historicalSheets.map((s) => (
              <div key={s.id} className="flex justify-between border-b py-1">
                <span>v{s.version} · {s.sheet_number} · {s.status}</span>
                <Button size="sm" variant="ghost" onClick={() => downloadReturnSheetPdf(s, sheetCompanyName(s))}>
                  <Download className="w-3 h-3 mr-1" /> PDF
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
