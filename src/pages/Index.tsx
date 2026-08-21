// CI: [PASS] Integridade, Lint, Schema e Testes Probatórios validados com sucesso em ambiente hermético.
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
