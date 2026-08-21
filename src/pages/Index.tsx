/* Finalize RH e Payables sem estados enganosos. Mantenha HR_CORE=false até create/update/delete_employee_v1 passarem em testes positivos e cross-tenant. Torne o optimistic locking atômico usando UPDATE ... WHERE version=p_expected_version e verifique ROW_COUNT. Em delete, carregue e audite o funcionário com id e tenant_id, recusando inexistente antes de qualquer log. Valide dependências também pelo tenant. Em Payables, remova completamente approveMut falso; preserve o botão desabilitado com aviso visível ou restaure a mutation real. Não altere folha, financeiro ou fiscal além do necessário para impedir chamadas quebradas. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
