import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, Info, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface AuditFinding {
  severity: string | null;
  domain: string | null;
  entity_type: string | null;
  entity_id: string | null;
  message: string | null;
  metadata: unknown;
}

const INTERNAL_ROLES = ['owner', 'admin', 'operator'];

const SEVERITY_ORDER = ['critical', 'high', 'error', 'warning', 'medium', 'low', 'info'];

function severityVariant(severity: string): 'destructive' | 'secondary' | 'outline' {
  const s = severity.toLowerCase();
  if (['critical', 'high', 'error'].includes(s)) return 'destructive';
  if (['warning', 'medium'].includes(s)) return 'secondary';
  return 'outline';
}

function toCsvValue(value: unknown): string {
  const raw = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export default function DataAudit() {
  const { currentTenant, currentRole, loading: tenantLoading } = useTenant();
  const [refreshing, setRefreshing] = useState(false);

  const allowed = !!currentRole && INTERNAL_ROLES.includes(currentRole);

  const query = useQuery({
    queryKey: ['audit-operational-congruence', currentTenant?.id],
    enabled: !!currentTenant?.id && allowed,
    queryFn: async (): Promise<AuditFinding[]> => {
      const { data, error } = await supabase.rpc('audit_operational_congruence_v1', {
        p_tenant_id: currentTenant!.id,
      });
      if (error) throw error;
      return (data ?? []) as AuditFinding[];
    },
  });

  const findings = query.data ?? [];

  const bySeverity = useMemo(() => {
    const map = new Map<string, number>();
    findings.forEach((f) => {
      const key = (f.severity ?? 'info').toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort(
      (a, b) => (SEVERITY_ORDER.indexOf(a[0]) + 99) % 100 - ((SEVERITY_ORDER.indexOf(b[0]) + 99) % 100),
    );
  }, [findings]);

  const byDomain = useMemo(() => {
    const map = new Map<string, AuditFinding[]>();
    findings.forEach((f) => {
      const key = f.domain ?? 'geral';
      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [findings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const handleExportCsv = () => {
    const header = ['severity', 'domain', 'entity_type', 'entity_id', 'message', 'metadata'];
    const lines = [header.join(',')];
    findings.forEach((f) => {
      lines.push([
        toCsvValue(f.severity),
        toCsvValue(f.domain),
        toCsvValue(f.entity_type),
        toCsvValue(f.entity_id),
        toCsvValue(f.message),
        toCsvValue(f.metadata),
      ].join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-congruencia-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (tenantLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Acesso restrito</AlertTitle>
          <AlertDescription>
            A auditoria de dados está disponível apenas para perfis owner, admin ou operador.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Auditoria de Dados
          </h1>
          <p className="text-sm text-muted-foreground">
            Verificação somente leitura de congruência operacional, fiscal e de despacho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={query.isFetching || refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${query.isFetching || refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={findings.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : query.isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Falha ao executar a auditoria</AlertTitle>
          <AlertDescription>
            {(query.error as Error)?.message ?? 'Erro desconhecido ao consultar a auditoria.'}
          </AlertDescription>
        </Alert>
      ) : findings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <ShieldCheck className="h-10 w-10 mx-auto text-primary" />
            <p className="text-lg font-medium">Sem inconsistências detectadas</p>
            <p className="text-sm text-muted-foreground">
              Nenhuma divergência de congruência foi encontrada para este tenant.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Total de ocorrências</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{findings.length}</p>
              </CardContent>
            </Card>
            {bySeverity.map(([severity, count]) => (
              <Card key={severity}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground capitalize">{severity}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <p className="text-3xl font-bold">{count}</p>
                  <Badge variant={severityVariant(severity)} className="capitalize">{severity}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ocorrências por domínio</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {byDomain.map(([domain, list]) => (
                <Badge key={domain} variant="outline" className="text-sm">
                  {domain}: {list.length}
                </Badge>
              ))}
            </CardContent>
          </Card>

          {byDomain.map(([domain, list]) => (
            <Card key={domain}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  {domain}
                  <Badge variant="secondary">{list.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[110px]">Severidade</TableHead>
                      <TableHead className="w-[260px]">Entidade</TableHead>
                      <TableHead>Mensagem</TableHead>
                      <TableHead className="w-[320px]">Metadados</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((f, idx) => (
                      <TableRow key={`${domain}-${idx}`}>
                        <TableCell>
                          <Badge variant={severityVariant(f.severity ?? 'info')} className="capitalize">
                            {f.severity ?? 'info'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{f.entity_type ?? '—'}</div>
                          <div className="text-muted-foreground font-mono break-all">{f.entity_id ?? '—'}</div>
                        </TableCell>
                        <TableCell className="text-sm">{f.message ?? '—'}</TableCell>
                        <TableCell>
                          <pre className="text-xs bg-muted/40 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all">
                            {f.metadata ? JSON.stringify(f.metadata, null, 2) : '—'}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
