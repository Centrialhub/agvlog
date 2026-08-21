/* Trabalhe somente no CRUD básico de Contas a Pagar; não implemente aprovação, cancelamento ou baixa. Crie RPCs forward-only `create_payable_v1` e `update_payable_v1` com tenant validado, papel financeiro/admin, allowlist e auditoria. Criação deve iniciar em `pending`; atualização deve impedir alteração de status e campos de aprovação/pagamento, usar versão otimista e preservar a sincronização existente com `financial_obligations`. Revogue INSERT/UPDATE direto de authenticated em `payables` após migrar o hook. Remova `status` do formulário de criação/edição, pois hoje a tela o envia e o hook descarta. Mantenha aprovar/cancelar desabilitados e não toque nas RPCs de pagamento. Aceite: testes autorizado, cross-tenant, stale version, sincronização e tentativa de alterar status. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
