import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertTriangle, AlertCircle } from 'lucide-react';

type Row = {
  severity: 'critical' | 'warning' | 'info';
  domain: string;
  entity_type: string;
  entity_id: string;
  message: string;
  suggested_action: string | null;
};

export default function DataAudit() {
  const { currentTenant } = useTenant();
  const [stamp, setStamp] = useState(0);
  const [domainFilter, setDomainFilter] = useState<string>('all');

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['data_audit', currentTenant?.id, stamp],
    queryFn: async (): Promise<Row[]> => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase as any).rpc('audit_data_consistency_v2', {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return (data || []) as Row[];
    },
    enabled: !!currentTenant,
  });

  const critical = data.filter(d => d.severity === 'critical');
  const warnings = data.filter(d => d.severity === 'warning');
  const infos = data.filter(d => d.severity === 'info' || d.severity === 'success');
  const domains = Array.from(new Set(data.map(d => d.domain))).sort();
  const filtered = domainFilter === 'all' ? data : data.filter(d => d.domain === domainFilter);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Auditoria de consistência</h1>
          <p className="text-sm text-muted-foreground">
            Inconsistências de dados detectadas no locatário atual.
          </p>
        </div>
        <Button onClick={() => { setStamp(s => s + 1); refetch(); }} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Reexecutar
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
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
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Informativos</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              <span className="text-3xl font-bold">{infos.length}</span>
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
        <CardHeader><CardTitle>Detalhamento</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-success">Nenhuma inconsistência detectada.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((r, i) => (
                <div key={`${r.entity_id}-${i}`} className="flex items-start gap-3 rounded border p-3">
                  <Badge variant={r.severity === 'critical' ? 'destructive' : r.severity === 'warning' ? 'secondary' : 'outline'}>
                    {r.severity}
                  </Badge>
                  <div className="flex-1 text-sm">
                    <div className="font-medium">{r.message}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.domain} · {r.entity_type} · <code>{r.entity_id}</code>
                    </div>
                    {r.suggested_action && (
                      <div className="text-xs mt-1 text-primary">→ {r.suggested_action}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}