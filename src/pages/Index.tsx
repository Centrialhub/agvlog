/* Verificar se o pipeline de ingestão está alimentando as tabelas corretas e se a RLS do tenant permite que o frontend carregue os dados do Index sem inconsistências. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
