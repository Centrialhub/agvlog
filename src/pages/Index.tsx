/* Trabalhe somente na semântica de atualização de funcionários. Em nova migration faça `CREATE OR REPLACE` de `update_employee_v1`. Torne `p_expected_version` obrigatório e use presença de chave JSON (`p_values ? 'campo'`) para distinguir campo ausente de `null`, permitindo limpar telefone, e-mail, desligamento, CNH, gerente e demais opcionais. Rejeite chaves desconhecidas/protegidas. Valide gerente, `driver_id` e `user_id` vinculados ao mesmo tenant quando informados. Atualize com filtro tenant/id/version e grave auditoria before/after com ator. No hook, `version` deve ser obrigatório e conflito deve gerar mensagem específica. Não altere folha, contratos ou layout. Aceite: testes de limpeza para null, versão obsoleta e referência cross-tenant. Mantenha `HR_CORE=false`. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
