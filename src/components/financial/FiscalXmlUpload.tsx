import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileUp, FileCheck2, AlertTriangle } from 'lucide-react';
import { parseFiscalXml, type ParsedFiscalXml } from '@/lib/nfeXmlParser';
import { toast } from '@/components/ui/sonner';

type Props = {
  onExtracted: (data: ParsedFiscalXml, file: File) => void;
  /** Which side of the document is the counterparty for autofill */
  perspective: 'payer' | 'receiver';
  className?: string;
};

/**
 * Client-side XML parser for NFe / NFSe. Fills form fields from the XML.
 * File is passed back so the parent can optionally upload it as receipt.
 */
export default function FiscalXmlUpload({ onExtracted, perspective, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [lastKind, setLastKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      if (!/\.xml$/i.test(file.name)) {
        toast.error('Selecione um arquivo XML de NFe ou NFSe.');
        return;
      }
      const parsed = await parseFiscalXml(file);
      if (parsed.kind === 'unknown') {
        toast.warning('XML não reconhecido como NFe ou NFSe. Preencha manualmente.');
      } else {
        toast.success(`${parsed.kind === 'nfe' ? 'NFe' : 'NFSe'} lida — campos preenchidos.`);
      }
      setLastFile(file);
      setLastKind(parsed.kind);
      onExtracted(parsed, file);
    } catch (e: any) {
      toast.error(e.message || 'Falha ao ler XML');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <FileUp className="h-3.5 w-3.5 mr-1" />
          {busy ? 'Lendo...' : 'Importar XML NFe/NFSe'}
        </Button>
        {lastFile && lastKind && lastKind !== 'unknown' && (
          <Badge variant="secondary" className="text-[10px] gap-1">
            <FileCheck2 className="h-3 w-3" /> {lastFile.name}
          </Badge>
        )}
        {lastFile && lastKind === 'unknown' && (
          <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-600/40">
            <AlertTriangle className="h-3 w-3" /> Layout não reconhecido
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        {perspective === 'payer'
          ? 'O XML preenche fornecedor, valor, vencimento (duplicatas) e nº documento.'
          : 'O XML preenche cliente, valor, nº fatura e vencimento.'}
      </p>
    </div>
  );
}