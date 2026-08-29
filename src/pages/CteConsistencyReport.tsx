import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, FileSearch, ArrowRight, ShieldCheck, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

export default function CteConsistencyReport() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const { data: violations = [], isLoading, refetch } = useQuery({
    queryKey: ['cte_consistency_violations', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant?.id) return [];
      const { data, error } = await supabase.rpc('monitor_simples_nacional_icms_violations', {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant?.id,
  });

  const filteredViolations = violations.filter((v: any) => 
    v.cte_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.emitter_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Auditoria de ICMS (Simples Nacional)</h1>
          <p className="text-sm text-muted-foreground">Monitoramento rigoroso para evitar destaque indevido de ICMS</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Executar Auditoria Agora
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Regras de Proteção Ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs space-y-2 text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-success mt-0.5" />
                <span><strong>Forçamento de ICMS Zero:</strong> O gerador de documentos (Builder) zera Base e Valor para emissores 'Simples' ou 'MEI'.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-success mt-0.5" />
                <span><strong>Consistência UI/Payload:</strong> A interface valida se os dados visíveis correspondem ao XML final antes do envio.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3 w-3 text-success mt-0.5" />
                <span><strong>Alerta de Bloqueio:</strong> O sistema impede a transmissão se detectar qualquer discrepância de regime tributário.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status da Auditoria</CardTitle>
          </CardHeader>
          <CardContent>
            {violations.length > 0 ? (
              <div className="flex flex-col items-center justify-center py-2 text-destructive">
                <AlertTriangle className="h-8 w-8 mb-2" />
                <span className="text-2xl font-bold">{violations.length}</span>
                <span className="text-xs text-center">Documentos Autorizados com Erro</span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-2 text-success">
                <ShieldCheck className="h-8 w-8 mb-2" />
                <span className="text-sm font-semibold">100% Consistente</span>
                <span className="text-xs text-center">Nenhuma violação detectada</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {violations.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Inconsistências no Banco de Dados</AlertTitle>
          <AlertDescription>
            Os documentos abaixo foram autorizados com destaque de ICMS antes da aplicação das novas travas de segurança. 
            Eles devem ser **Excluídos e Reemitidos** (ou Cancelados se forem antigos) para regularização fiscal.
          </AlertDescription>
        </Alert>
      ) : !isLoading && (
        <Alert className="bg-success/10 border-success/20 text-success">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertTitle>Auditoria Concluída: Risco Zero</AlertTitle>
          <AlertDescription>
            O motor de auditoria confirmou que todos os CT-es emitidos recentemente respeitam a regra de ICMS zerado.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            Lista de Documentos Irregulares
          </CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar por nº ou emitente..."
              className="pl-8 h-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
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
                <TableHead>Data Emissão</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredViolations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {isLoading ? 'Carregando auditoria...' : searchTerm ? 'Nenhum resultado para o filtro.' : 'Excelente! Nenhum documento irregular encontrado.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredViolations.map((v: any) => (
                  <TableRow key={v.fiscal_document_id} className="group">
                    <TableCell className="font-mono">{v.cte_number || '—'}</TableCell>
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
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => navigate(`/cte-monitor`)}
                      >
                        Corrigir <ArrowRight className="h-4 w-4 ml-2" />
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
