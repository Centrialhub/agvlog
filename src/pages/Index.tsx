/* Trabalhe somente na criação segura de cargas V2. Em migration forward-only crie `create_load_v2`; não altere migrations antigas. Use `SECURITY DEFINER` com `search_path`, exija operador/admin vinculado ao tenant, valide veículo e motorista no mesmo tenant, aplique advisory lock por tenant e gere `load_number` compatível com valores legados não numéricos, sem `MAX(load_number::int)`. Idempotência deve registrar operação, hash do payload e `result_id`: retry idêntico retorna o mesmo ID; mesma chave com payload diferente falha. Não exponha helper genérico de ownership. Revogue PUBLIC/anon e INSERT/UPDATE/DELETE direto em `loads`. Atualize hook/tipos apenas no caminho V2 e mantenha a flag falsa. Aceite: testes reais de concorrência, retry e cross-tenant. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
