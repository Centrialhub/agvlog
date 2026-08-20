import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Refaça listagens e buscas de cargas, documentos, operações, rotas, viagens, clientes e motorista sobre read models/RPCs server-side. Busca, filtros, ordenação, contagem e paginação por cursor devem ocorrer no banco antes do limite. Remova pré-limites arbitrários, junções incompletas e filtros client-side sobre amostras. Padronize texto normalizado, datas inclusivas, status, tenant e escopo. Cada resposta deve trazer cursor, total quando necessário e critérios aplicados. Teste que registros além de 10 mil itens sejam encontrados.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
