/* Trabalhe somente na contenção de estados de Contas a Pagar. Não altere RH, folha, conciliação, fiscal, migrations ou layout. Em src/pages/Payables.tsx, remova approveMut falso, código morto, status do formulário e quickUpdate. Novas contas nascem pending; edição altera apenas fornecedor, categoria, descrição, valor, datas, documento, notas e recibo. Aprovar e cancelar ficam desabilitados com aviso explícito; baixa segue apenas pelo fluxo register_payable_payment. Em src/hooks/usePayables.tsx, remova useApproveFinancialObligation placeholder. Use allowlists explícitas no create/update e nunca aceite status, approved_*, paid_*, paid_amount, source, tenant_id ou created_by do chamador. Update deve filtrar id e tenant_id e falhar se não retornar linha. Adicione testes: criação sempre pending, edição preserva estado e injeção de campos protegidos é ignorada. Rode guardrails, lint, typecheck, testes e build; informe comandos/resultados reais e arquivos alterados. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
