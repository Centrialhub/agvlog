/* Trabalhe somente no despacho seguro de rota V2. Crie uma única RPC forward-only `plan_dispatch_trip_v3` e elimine do frontend a dependência das duas sobrecargas incompatíveis de `plan_dispatch_trip_v2`. Use contrato único para rota, cargas e paradas; padronize `fiscal_document_ids`. Exija operador/admin; valide veículo, motorista, todas as cargas, clientes e documentos no mesmo tenant; confirme que a quantidade encontrada é igual à solicitada; bloqueie cargas com `FOR UPDATE`; grave `dispatch_trip_loads.dispatch_trip_id`, paradas e documentos; atualize cargas com filtro de tenant. A operação deve ser atômica e idempotente, retornando o mesmo trip no retry. Atualize hook/tipos, mantenha a flag falsa. Aceite: testes de sucesso, rollback, retry e cross-tenant. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
