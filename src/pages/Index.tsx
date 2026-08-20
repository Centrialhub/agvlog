import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Reorganize o financeiro operacional sem alterar emissão fiscal. Viagem e carga canônicas devem originar despesas, adiantamentos, acertos, contas a receber e faturamento operacional por referências estáveis, nunca por texto ou cópia solta. Defina ledger imutável e RPCs idempotentes para aprovar, estornar, conciliar e pagar, com auditoria e bloqueio de dupla liquidação. Unifique funções repetidas de settlement em uma versão canônica. Faça telas, relatórios e exportações usarem o mesmo read model e reconcilie saldo com lançamentos.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
