import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">Arquitetura de Cargas Consolidada</h1>
      <p className="max-w-2xl text-muted-foreground">
        Consolide cargas e documentos operacionais. load_items será a fonte única da composição; fiscal_documents.load_id e load_documents serão espelhos/projeções compatíveis. Crie RPCs transacionais e idempotentes para adicionar, remover, mover e vincular documentos, recalculando peso, valor e quantidade no servidor e auditando antes/depois. Substitua toda escrita direta do frontend nessas relações. Crie read model único de carga com documentos e divergências. Adicione diagnóstico e reparo por tenant com dry-run e execução somente por IDs aprovados; proíba UPDATE global.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;
