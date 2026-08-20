import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Data Quality Center & Baseline Consolidation</h1>
      <p className="max-w-2xl text-muted-foreground">
        Transforme /data-audit em Data Quality Center com inconsistências de vínculos, órfãos, espelhos, estados, duplicidades, RLS, funções antigas e filas travadas. Reparos exigem dry-run, lote imutável, IDs explícitos, aprovação separada, transação, resultado por item e compensação; nunca UPDATE/DELETE global. Adicione testes de schema, RLS, idempotência, concorrência, filtros e E2E. Só após zero críticos, gere baseline limpa para novos ambientes sem reescrever migrations já aplicadas, mantenha compatibilidade e faça rollout por feature flags.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
