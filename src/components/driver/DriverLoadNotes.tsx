import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Download, ExternalLink, FileText, Loader2, Printer, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import {
  parseDriverFiscalCatalog,
  parseDriverFiscalFile,
  type DriverFiscalDocument,
  type DriverFiscalDocumentKind,
  type DriverFiscalFileFormat,
} from '@/lib/driver/fiscalCatalog';
import { printRomaneioRoutes, type RomaneioDoc } from '@/lib/romaneioPrint';

interface Props {
  loadId: string;
  loadNumber?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
}

const DOCUMENT_LABEL: Record<DriverFiscalDocumentKind, string> = {
  nfe: 'NF-e',
  cte: 'CT-e',
  nfse: 'NFS-e',
};

const DOCUMENT_STATUS: Record<DriverFiscalDocumentKind, string> = {
  nfe: 'Vinculada à carga',
  cte: 'Autorizado',
  nfse: 'Autorizada',
};

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value: DriverFiscalDocument['issued_at']) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? match[3] + '/' + match[2] + '/' + match[1] : '';
}

export default function DriverLoadNotes({ loadId, loadNumber, vehiclePlate, driverName }: Props) {
  const [open, setOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  const actorId = user?.id;
  const canQuery = !!actorId && !!tenantId && !!loadId;

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['driver_load_fiscal_catalog', actorId, tenantId, loadId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('driver_list_load_fiscal_catalog', {
        _tenant_id: tenantId!,
        _load_id: loadId,
      }).abortSignal(signal);
      if (error) throw error;
      return parseDriverFiscalCatalog(data, loadId);
    },
    enabled: canQuery && open,
    retry: false,
  });

  const docs = data?.documents ?? [];
  const notes = docs.filter((document) => document.kind === 'nfe');
  const loading = canQuery && isPending;

  const handlePrint = () => {
    const romaneioDocs: RomaneioDoc[] = notes.map((document) => ({
      city: document.destination_city || '',
      state: document.destination_state || '',
      remetente: document.issuer || '',
      destinatario: document.recipient || '',
      bairro: '',
      nfNumber: document.number || '',
      emissao: formatDate(document.issued_at),
      valor: document.amount || 0,
      peso: document.weight_kg || 0,
      volumes: document.volume_count || 0,
    }));
    printRomaneioRoutes(
      [{
        routeName: ('Carga ' + (loadNumber || '')).trim(),
        vehicleInfo: vehiclePlate ? 'Veículo: ' + vehiclePlate : undefined,
        driverInfo: driverName ? 'Motorista: ' + driverName : undefined,
        docs: romaneioDocs,
      }],
      'Romaneio ' + (loadNumber || ''),
    );
  };

  const handleFiscalFile = async (
    document: DriverFiscalDocument,
    format: DriverFiscalFileFormat,
  ) => {
    if (document.kind === 'nfe' || !tenantId) return;
    const requestKey = document.id + ':' + format;
    setActiveFile(requestKey);
    setFileError(null);

    try {
      const { data: fileData, error: fileQueryError } = await supabase.rpc(
        'driver_get_load_fiscal_file',
        {
          _tenant_id: tenantId,
          _load_id: loadId,
          _document_kind: document.kind,
          _document_id: document.id,
          _format: format,
        },
      );
      if (fileQueryError) throw fileQueryError;

      const file = parseDriverFiscalFile(fileData, {
        loadId,
        kind: document.kind,
        documentId: document.id,
        format,
      });

      const link = window.document.createElement('a');
      link.rel = 'noopener noreferrer';
      if (file.source === 'url') {
        link.href = file.url;
        link.target = '_blank';
      } else {
        const objectUrl = URL.createObjectURL(new Blob([file.content], { type: 'application/xml;charset=utf-8' }));
        link.href = objectUrl;
        link.download = file.filename;
        link.click();
        URL.revokeObjectURL(objectUrl);
        return;
      }
      link.click();
    } catch {
      setFileError('Não foi possível abrir o arquivo fiscal. Tente novamente.');
    } finally {
      setActiveFile(null);
    }
  };

  return (
    <div className="border-t pt-2 mt-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={'driver-fiscal-catalog-' + loadId}
          className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Documentos fiscais</span>
          {open && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {loading || isFetching ? '…' : error ? '!' : docs.length}
            </Badge>
          )}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px] px-2"
          disabled={loading || isFetching || notes.length === 0}
          onClick={handlePrint}
        >
          <Printer className="h-3 w-3 mr-1" /> Romaneio NF-e
        </Button>
      </div>

      {open && (
        <div id={'driver-fiscal-catalog-' + loadId} className="space-y-1.5">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando documentos fiscais…
            </div>
          )}
          {!loading && error && (
            <div role="alert" className="rounded border border-destructive/40 p-2 space-y-2">
              <p className="text-[11px] text-destructive">
                Não foi possível consultar os documentos fiscais desta carga.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                disabled={isFetching}
                onClick={() => { void refetch(); }}
              >
                {isFetching
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <RefreshCw className="h-3 w-3 mr-1" />}
                Tentar novamente
              </Button>
            </div>
          )}
          {!loading && !error && docs.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic py-1">
              Nenhum documento fiscal disponível para esta carga.
            </p>
          )}
          {!loading && !error && docs.length > 0 && (
            <>
              <div className="max-h-56 overflow-y-auto rounded border bg-muted/30 divide-y">
                {docs.map((document) => (
                  <div key={document.id} className="p-2 text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {DOCUMENT_LABEL[document.kind]} {document.number || '—'}
                      </span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                        {DOCUMENT_STATUS[document.kind]}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground truncate">{document.recipient || '—'}</div>
                    <div className="text-muted-foreground text-[10px]">
                      {document.destination_city || '—'}
                      {document.destination_state ? '/' + document.destination_state : ''}
                      {document.amount !== null ? ' · ' + formatCurrency(document.amount) : ''}
                      {document.weight_kg ? ' · ' + document.weight_kg.toLocaleString('pt-BR') + ' kg' : ''}
                      {document.volume_count ? ' · ' + document.volume_count + ' vol.' : ''}
                    </div>
                    {(document.available_files.pdf || document.available_files.xml) && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {document.available_files.pdf && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[10px]"
                            disabled={activeFile !== null}
                            aria-label={'Abrir PDF do ' + DOCUMENT_LABEL[document.kind] + ' ' + (document.number || '')}
                            onClick={() => { void handleFiscalFile(document, 'pdf'); }}
                          >
                            {activeFile === document.id + ':pdf'
                              ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              : <ExternalLink className="h-3 w-3 mr-1" />}
                            PDF
                          </Button>
                        )}
                        {document.available_files.xml && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[10px]"
                            disabled={activeFile !== null}
                            aria-label={'Abrir XML do ' + DOCUMENT_LABEL[document.kind] + ' ' + (document.number || '')}
                            onClick={() => { void handleFiscalFile(document, 'xml'); }}
                          >
                            {activeFile === document.id + ':xml'
                              ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              : <Download className="h-3 w-3 mr-1" />}
                            XML
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {fileError && <p role="alert" className="text-[11px] text-destructive px-1">{fileError}</p>}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
                <span>{docs.length} documento{docs.length === 1 ? '' : 's'}</span>
                <span>{notes.length} NF-e na carga</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
