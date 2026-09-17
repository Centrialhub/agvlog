import { useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import {
  useDownloadPortalFiscalFile,
  usePortalFiscalBundle,
} from '@/hooks/portal/usePortalFiscalBundle';
import type {
  PortalFiscalDocument,
  PortalFiscalFileFormat,
} from '@/lib/portal/portalFiscalBundle';
import { portalErrorMessage } from '@/lib/portal/portalErrors';

const LABEL = { cte: 'CT-e', nfse: 'NFS-e' } as const;

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : 'Data não informada';
}

function formatMoney(value: number | null) {
  return value == null
    ? null
    : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function openFiscalFile(file: { blob: Blob; filename: string }) {
  const objectUrl = URL.createObjectURL(file.blob);
  const link = window.document.createElement('a');
  link.href = objectUrl;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export function PortalFiscalBundle({ fiscalDocumentId }: { fiscalDocumentId: string }) {
  const { data, isLoading, error, refetch, isFetching } = usePortalFiscalBundle(fiscalDocumentId);
  const download = useDownloadPortalFiscalFile(fiscalDocumentId);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFile = async (
    document: PortalFiscalDocument,
    format: PortalFiscalFileFormat,
  ) => {
    const key = `${document.id}:${format}`;
    setActiveFile(key);
    setFileError(null);
    try {
      openFiscalFile(await download.mutateAsync({ document, format }));
    } catch (caught: unknown) {
      setFileError(portalErrorMessage(caught, 'Não foi possível abrir o arquivo fiscal.'));
    } finally {
      setActiveFile(null);
    }
  };

  if (isLoading) {
    return <div role="status" className="flex items-center gap-2 py-5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando documentos vinculados…</div>;
  }

  if (error) {
    return (
      <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
        <p>Não foi possível consultar os CT-e e NFS-e vinculados.</p>
        <Button size="sm" variant="outline" disabled={isFetching} onClick={() => { void refetch(); }}>
          {isFetching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!data || data.documents.length === 0) {
    return (
      <PortalEmptyState
        title="Nenhum CT-e ou NFS-e vinculado"
        description="Quando a transportadora emitir documentos para esta NF, eles aparecerão aqui com os arquivos disponíveis."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {data.documents.map((document) => {
          const amount = formatMoney(document.amount);
          return (
            <div key={`${document.kind}:${document.id}`} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{LABEL[document.kind]} {document.number || 'sem número'}</span>
                    <Badge variant="outline" className="text-[10px]">{document.status || 'emitido'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(document.issued_at)}
                    {document.series ? ` · Série ${document.series}` : ''}
                    {document.recipient ? ` · ${document.recipient}` : ''}
                    {amount ? ` · ${amount}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {document.available_files.pdf && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!data.can_download_documents || activeFile !== null}
                      onClick={() => { void handleFile(document, 'pdf'); }}
                      aria-label={`Abrir PDF do ${LABEL[document.kind]} ${document.number || ''}`}
                    >
                      {activeFile === `${document.id}:pdf` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ExternalLink className="mr-1 h-3 w-3" />}
                      PDF
                    </Button>
                  )}
                  {document.available_files.xml && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!data.can_download_documents || activeFile !== null}
                      onClick={() => { void handleFile(document, 'xml'); }}
                      aria-label={`Baixar XML do ${LABEL[document.kind]} ${document.number || ''}`}
                    >
                      {activeFile === `${document.id}:xml` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                      XML
                    </Button>
                  )}
                </div>
              </div>
              {!data.can_download_documents && (document.available_files.pdf || document.available_files.xml) && (
                <p className="mt-2 text-xs text-muted-foreground">Seu acesso permite visualizar o documento, mas não baixar arquivos.</p>
              )}
            </div>
          );
        })}
      </div>
      {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
    </div>
  );
}
