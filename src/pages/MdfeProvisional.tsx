import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuthorizedCteList, AuthorizedCte } from '@/hooks/useAuthorizedCteList';
import { format } from 'date-fns';
import { Loader2, Send, RefreshCw, XCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';

export default function MdfeProvisional() {
  const { data: ctes, isLoading, refetch } = useAuthorizedCteList();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isTransmitting, setIsTransmitting] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === (ctes?.length || 0)) {
      setSelectedIds([]);
    } else {
      setSelectedIds(ctes?.map(c => c.id) || []);
    }
  };

  const handleTransmit = async () => {
    if (selectedIds.length === 0) {
      toast.error("Selecione ao menos um CT-e para o manifesto");
      return;
    }
    
    setIsTransmitting(true);
    try {
      // Implementação futura da transmissão via Hub
      toast.info("Funcionalidade de transmissão em desenvolvimento (Engine v1 pronta)");
      console.log("Selecionados para MDF-e:", selectedIds);
    } finally {
      setIsTransmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MDF-e (Provisório)</h1>
          <p className="text-muted-foreground">
            Selecione CT-es autorizados para vincular ao manifesto.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Sincronizar
          </Button>
          <Button 
            disabled={selectedIds.length === 0 || isTransmitting}
            onClick={handleTransmit}
          >
            {isTransmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Gerar e Transmitir MDF-e
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CT-es Disponíveis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{ctes?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Selecionados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{selectedIds.length}</div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status Motor</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Badge className="bg-green-500/10 text-green-500">Engine v1 Ativa</Badge>
            <span className="text-xs text-muted-foreground">Pronto para homologação</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>CT-es Autorizados</CardTitle>
          <CardDescription>
            Apenas documentos com status 'Autorizado' podem ser vinculados ao MDF-e.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : ctes && ctes.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox 
                        checked={ctes.length > 0 && selectedIds.length === ctes.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead>Remetente / Destinatário</TableHead>
                    <TableHead>Cidade Destino</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ctes.map((cte) => (
                    <TableRow key={cte.id} className={selectedIds.includes(cte.id) ? "bg-muted/50" : ""}>
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.includes(cte.id)}
                          onCheckedChange={() => toggleSelect(cte.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {cte.cte_number || '---'}
                        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]">
                          {cte.access_key}
                        </div>
                      </TableCell>
                      <TableCell>
                        {cte.issued_at ? format(new Date(cte.issued_at), 'dd/MM/yyyy') : '---'}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium truncate max-w-[200px]">{cte.remitter}</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{cte.recipient}</div>
                      </TableCell>
                      <TableCell>{cte.recipient_city}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => {
                          toast.error("Cancelamento direto de CT-e deve ser feito no Monitor de CT-e");
                        }}>
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium">Nenhum CT-e autorizado encontrado</h3>
              <p className="text-sm text-muted-foreground">
                Certifique-se de que os CT-es foram emitidos e autorizados com sucesso.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
