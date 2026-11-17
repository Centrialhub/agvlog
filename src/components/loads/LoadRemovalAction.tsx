import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeleteLoad, type Load } from '@/hooks/useLoads';
import { useLoadDocumentChanges } from '@/hooks/useLoadDocumentChanges';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { DocumentChangeDialog, type DocumentChangeSelection } from './DocumentChangeDialog';
import { DocumentChangeRecoveryPanel } from './DocumentChangeRecoveryPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/errors';

export function LoadRemovalAction({ load, documentIds }: { load: Load; documentIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<DocumentChangeSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const documents = useLoadDocumentChanges();
  const deletion = useDeleteLoad();
  const navigate = useNavigate();
  const toast = useSonnerToast();
  const blocked = documents.isPending || documents.pending.length > 0 || !!documents.recoveryError || deletion.isPending;
  return <>
    <Button variant="outline" size="sm" onClick={() => { setError(null); setOpen(true); }}>Excluir carga / Liberar notas</Button>
    <Dialog open={open} onOpenChange={value => { if (!blocked) setOpen(value); }}>
      <DialogContent><DialogHeader>
        <DialogTitle>Excluir carga {load.load_number}</DialogTitle>
        <DialogDescription>{documentIds.length
          ? `Primeiro, libere as ${documentIds.length} nota(s) desta carga. Os documentos fiscais serão preservados para outra programação. A carga vazia poderá ser removida automaticamente, conforme seus vínculos.`
          : 'Confirme a exclusão da carga vazia. Viagens, itens e vínculos financeiros podem impedir a exclusão.'}</DialogDescription>
      </DialogHeader>
        {load.on_hold ? <p role="alert">A carga está em espera. Use Liberar Travas antes de alterar sua composição.</p> : null}
        <DocumentChangeRecoveryPanel />
        {error ? <p role="alert">{error}</p> : null}
        <Button variant="destructive" disabled={blocked || !!load.on_hold} onClick={async () => {
          if (documentIds.length) {
            setOpen(false);
            setSelection({ action: 'detach', documentIds: [...new Set(documentIds)] });
            return;
          }
          try {
            await deletion.mutateAsync({ id: load.id, expectedVersion: load.version });
            toast.success('Carga excluída.');
            navigate('/loads');
          } catch (failure) { setError(getErrorMessage(failure)); }
        }}>{documentIds.length ? 'Liberar todas as notas' : 'Confirmar exclusão da carga vazia'}</Button>
      </DialogContent>
    </Dialog>
    <DocumentChangeDialog api={documents} loadId={load.id} selection={selection} onClose={() => setSelection(null)}
      onFailure={message => toast.error(message)} onConfirmed={result => {
        toast.success(`${result.document_count} nota(s) liberadas para outra carga.${result.load_removed ? ' Carga vazia removida.' : ' A carga foi preservada; confira os vínculos restantes antes de excluí-la.'}`);
        navigate('/loads');
      }} />
  </>;
}
