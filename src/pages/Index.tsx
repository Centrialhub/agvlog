import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
Reconstrua o app do motorista sobre um driver_workspace canônico retornado por RPC: viagem ativa, cargas, paradas ordenadas, documentos, permissões, progresso e próxima ação. Remova fallbacks e escritas diretas em dispatch_trips e loads. Início, chegada, saída, entrega, recusa, parcial, retorno e finalização usarão RPCs idempotentes, validando motorista, tenant e estado e retornando resultado por item. Implemente outbox offline com retry seguro, bloqueio de duplo toque e retenção de evidências até confirmação. Cubra o fluxo em testes E2E.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
