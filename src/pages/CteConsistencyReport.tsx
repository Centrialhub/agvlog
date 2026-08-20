import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, FileSearch, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';

export default function CteConsistencyReport() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  const { data: violations = [], isLoading, refetch } = useQuery({
    queryKey: ['cte_consistency_violations', currentTenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('monitor_simples_nacional_icms_violations');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatório de Consistência ICMS</h1>
          <p className="text-sm text-muted-foreground">Monitoramento de emissores Simples Nacional</p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          Atualizar Relatório
        </Button>
      </div>

      {violations.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Inconsistências Detectadas</AlertTitle>
          <AlertDescription>
            Foram encontrados {violations.length} CT-es emitidos por empresas do Simples Nacional com ICMS destacado.
            Estes documentos precisam de correção ou cancelamento imediato para evitar multas fiscais.
          </AlertDescription>
        </Alert>
      ) : !isLoading && (
        <Alert className="bg-success/10 border-success/20 text-success">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertTitle>Ambiente Íntegro</AlertTitle>
          <AlertDescription>
            Nenhuma inconsistência de ICMS para Simples Nacional foi detectada nas últimas emissões.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            Documentos para Revisão
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº CT-e</TableHead>
                <TableHead>Emitente</TableHead>
                <TableHead className="text-right">Base ICMS</TableHead>
                <TableHead className="text-right">Alíquota %</TableHead>
                <TableHead className="text-right">Valor ICMS</TableHead>
                <TableHead>Data</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {violations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {isLoading ? 'Carregando...' : 'Nenhum documento com erro encontrado.'}
                  </TableCell>
                </TableRow>
              ) : (
                violations.map((v: any) => (
                  <TableRow key={v.fiscal_document_id}>
                    <TableCell className="font-mono">{v.cte_number}</TableCell>
                    <TableCell className="font-medium">{v.emitter_name}</TableCell>
                    <TableCell className="text-right">
                      {v.icms_base?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">{v.icms_aliquota}%</TableCell>
                    <TableCell className="text-right font-semibold text-destructive">
                      {v.icms_valor?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => navigate(`/cte-monitor`)}
                      >
                        Ver no Monitor <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
