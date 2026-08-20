import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Refaça o portal sobre um único escopo autorizado. Se houver um cliente, selecione-o automaticamente; com vários, ofereça seleção e modo Todos. Resumo, busca, documentos, entregas, alertas e rastreamento devem usar o mesmo conjunto efetivo por client_id, remetente ou destinatário, sem retornar vazio por clientId nulo. Crie portal_shipment_read_model e timeline única, aplique RLS/ownership e elimine consultas paralelas. Teste usuário com 1 cliente, vários, remetente, destinatário e tentativa cross-tenant.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
