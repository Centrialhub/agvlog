/* Trabalhe somente em `scripts/guardrails/schema-check.py`. Remova `THRESHOLD` e toda exclusão por data. Analise todas as migrations em ordem cronológica e compare assinaturas entre `CREATE FUNCTION` e `GRANT/REVOKE/ALTER FUNCTION`, incluindo SQL multilinha e sobrecargas. Normalize conforme os argumentos de identidade do PostgreSQL: considere tipos de entrada e arrays, ignore nomes de parâmetros e `DEFAULT`, e preserve tipos qualificados. Se Supabase CLI ou Docker não estiver disponível, encerre com código diferente de zero; `supabase db reset` é obrigatório e nunca pode ser ignorado. Exiba arquivo, linha, ação e assinatura. Não edite migrations, CI, testes ou aplicação. Aceite: a base atual fica vermelha e aponta ao menos `20260821004409` e `20260821020545`, sem falso sucesso. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
