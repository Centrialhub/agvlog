import { Navigate } from 'react-router-dom';

const Index = () => {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-8 text-center space-y-4">
      <h1 className="text-xl font-bold text-primary">AGVLog - Sistema de Gestão Logística</h1>
      <p className="max-w-2xl text-muted-foreground">
        Plataforma unificada para gestão de frotas, cargas e documentos fiscais.
      </p>
      <div className="pt-4">
        <Navigate to="/dashboard" replace />
      </div>
    </div>
  );
};

export default Index;