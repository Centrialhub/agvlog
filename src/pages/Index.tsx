import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">AGVLog - Sistema de Gestão Logística</h1>
      <p className="max-w-2xl text-muted-foreground">
        Corrigi a segurança de toda a camada adicionada. As permissões agora utilizam validação de membership (tenant_memberships) em vez de metadados do JWT, protegendo contra vazamentos entre tenants. RPCs SECURITY DEFINER foram blindadas com validação de ownership e tenant_id, e o acesso público foi revogado.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;