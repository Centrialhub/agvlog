import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Centralize estados de carga, viagem, parada e documento operacional em máquinas de transição explícitas. Nenhuma tela pode atualizar status diretamente. Implemente RPCs com transições permitidas, optimistic locking, idempotency_key, motivo, ator e entity_audit_log. Derive estados agregados de carga e viagem pelas paradas e resultados por documento, sem sobrescrever estado fiscal. Crie audit_data_consistency_v3 para órfãos, espelhos divergentes, transições impossíveis e duplicidades, com reparo dry-run/aprovação/execução por IDs e testes de concorrência.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
