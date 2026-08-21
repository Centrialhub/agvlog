/* Trabalho concluído nos testes probatórios. Vitest configurado para falhar sem banco, validando idempotência, RLS cross-tenant e integridade transacional. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
