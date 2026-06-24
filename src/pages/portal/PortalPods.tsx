import { useState } from 'react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalPods, useDownloadPortalPod } from '@/hooks/portal/usePortalPods';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Download } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  uploaded: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  validated: 'bg-green-500/15 text-green-700 dark:text-green-400',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-400',
  missing: 'bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  uploaded: 'Recebido',
  validated: 'Validado',
  rejected: 'Rejeitado',
  missing: 'Não enviado',
};

export default function PortalPods() {
  const [status, setStatus] = useState<string>('all');
  const { data: pods = [], isLoading } = usePortalPods({ status: status === 'all' ? undefined : status });
  const download = useDownloadPortalPod();
  const { toast } = useToast();

  const handleDownload = async (id: string) => {
    try {
      const url = await download.mutateAsync(id);
      window.open(url, '_blank');
    } catch (e: any) {
      toast({ title: 'Erro ao baixar', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <PortalSection title="Canhotos / POD" description="Comprovantes de entrega das suas mercadorias.">
      <div className="mb-4">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="uploaded">Recebido</SelectItem>
            <SelectItem value="validated">Validado</SelectItem>
            <SelectItem value="rejected">Rejeitado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : pods.length === 0 ? (
            <PortalEmptyState title="Sem canhotos" description="Nenhum comprovante registrado para os filtros aplicados." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nota</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Recebido em</TableHead>
                  <TableHead>Recebedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pods.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.invoice_number || '—'}</TableCell>
                    <TableCell className="text-xs uppercase">{p.proof_type}</TableCell>
                    <TableCell>{p.received_at ? format(new Date(p.received_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '—'}</TableCell>
                    <TableCell>
                      <div className="text-sm">{p.receiver_name || '—'}</div>
                      {p.receiver_role && <div className="text-xs text-muted-foreground">{p.receiver_role}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_TONE[p.status] || ''}>{STATUS_LABEL[p.status] || p.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {p.has_file && (
                        <Button size="sm" variant="outline" onClick={() => handleDownload(p.id)} disabled={download.isPending}>
                          <Download className="h-4 w-4 mr-1" /> Baixar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PortalSection>
  );
}
