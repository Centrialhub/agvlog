import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertTriangle, AlertCircle, CheckCircle2, ShieldCheck, Database, Hammer, History } from 'lucide-react';
import { useAlertStore } from '@/hooks/useAlertStore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';

type Row = {
  severity: 'critical' | 'warning' | 'info' | 'success';
  domain: string;
  entity_type: string;
  entity_id: string;
  message: string;
  suggested_action: string | null;
  metadata: any;
};

export default function DataQualityCenter() {
  const { currentTenant } = useTenant();
  const showAlert = useAlertStore(state => state.showAlert);
  const queryClient = useQueryClient();
  const [stamp, setStamp] = useState(0);
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['data_quality_audit', currentTenant?.id, stamp],
    queryFn: async (): Promise<Row[]> => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase as any).rpc('audit_data_consistency_v4', {
        p_tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return (data || []) as Row[];
    },
    enabled: !!currentTenant,
  });

  const createBatch = useMutation({
    mutationFn: async () => {
      if (!currentTenant || selectedIds.length === 0) return;
      
      const selectedItems = data.filter(d => selectedIds.includes(d.entity_id));
      
      const { data: batch, error } = await supabase
        .from('data_repair_batches')
        .insert({
          tenant_id: currentTenant.id,
          status: 'draft',
          description: `Reparo manual de ${selectedIds.length} itens`,
          dry_run_report: { items: selectedItems }
        })
        .select()
        .single();
      
      if (error) throw error;
      return batch;
    },
    onSuccess: () => {
      alert('Lote de reparo criado em rascunho. Vá para Histórico para aprovar e executar.', 'success');
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['data_repair_batches'] });
    }
  });

  const critical = data.filter(d => d.severity === 'critical');
  const warnings = data.filter(d => d.severity === 'warning');
  const domains = Array.from(new Set(data.map(d => d.domain))).sort();
  const filtered = domainFilter === 'all' ? data : data.filter(d => d.domain === domainFilter);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Data Quality Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitoramento de integridade, vínculos e segurança (RLS/Estados).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setStamp(s => s + 1); refetch(); }} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Scan Geral
          </Button>
          <Button 
            disabled={selectedIds.length === 0 || createBatch.isPending}
            onClick={() => createBatch.mutate()}
          >
            <Hammer className="h-4 w-4 mr-2" />
            Criar Lote de Reparo ({selectedIds.length})
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Críticos</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-3xl font-bold">{critical.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Alertas</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <span className="text-3xl font-bold">{warnings.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Database Score</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-500" />
              <span className="text-3xl font-bold text-blue-500">
                {Math.max(0, 100 - (critical.length * 5) - (warnings.length * 2))}%
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Baseline Status</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {critical.length === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {critical.length === 0 ? 'Pronto para Baseline' : 'Bloqueado (Resolver Críticos)'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {domains.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={domainFilter === 'all' ? 'default' : 'outline'} onClick={() => setDomainFilter('all')}>
            Todos ({data.length})
          </Button>
          {domains.map(d => (
            <Button key={d} size="sm" variant={domainFilter === d ? 'default' : 'outline'} onClick={() => setDomainFilter(d)}>
              {d} ({data.filter(x => x.domain === d).length})
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Inconsistências Detectadas</CardTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(filtered.map(x => x.entity_id))}>Selecionar Todos</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>Limpar</Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Analizando integridade dos dados...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-2" />
              <p className="text-success font-medium">Nenhuma inconsistência detectada.</p>
              <p className="text-xs text-muted-foreground">Seu banco de dados está operando em conformidade.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead className="w-[100px]">Gravidade</TableHead>
                  <TableHead className="w-[120px]">Domínio</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead>Sugestão</TableHead>
                  <TableHead className="text-right">Entidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, i) => (
                  <TableRow key={`${r.entity_id}-${i}`}>
                    <TableCell>
                      <Checkbox 
                        checked={selectedIds.includes(r.entity_id)}
                        onCheckedChange={() => toggleSelection(r.entity_id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        r.severity === 'critical' ? 'destructive' : 
                        r.severity === 'warning' ? 'secondary' : 
                        'outline'
                      }>
                        {r.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-medium">{r.domain}</TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{r.message}</div>
                      {r.metadata && Object.keys(r.metadata).length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                          {JSON.stringify(r.metadata)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-primary">{r.suggested_action}</TableCell>
                    <TableCell className="text-right text-[10px] text-muted-foreground font-mono">
                      {r.entity_type}:{r.entity_id.substring(0, 8)}...
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      <div className="flex justify-end gap-2">
         <Button variant="outline" className="text-xs">
            <History className="h-3 w-3 mr-1" />
            Histórico de Reparos
         </Button>
      </div>
    </div>
  );
}
