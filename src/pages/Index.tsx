import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
Crie uma camada única de repositories/hooks tipados para os read models canônicos. Páginas centrais não devem usar supabase.from diretamente nem reconstruir relações localmente. Padronize query keys, cache por tenant/usuário/filtros, cancelamento, invalidação após mutações, erros e estados vazios. Elimine hooks duplicados e consultas diferentes para a mesma entidade. Preserve a UI válida. Adicione testes de contrato garantindo que dashboard, lista, detalhe e relatório retornem os mesmos IDs e estados para o mesmo filtro.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
