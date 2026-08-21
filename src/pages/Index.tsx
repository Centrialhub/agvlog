/* Trabalhe somente no gate real de migrations. Substitua `scripts/guardrails/schema-check.py`, que hoje apenas simula o reset, por uma prova executável: rode `supabase db reset` em banco efêmero/local e falhe quando Supabase CLI, Docker ou banco não estiverem disponíveis; nunca use fallback verde. Acrescente verificação estática de referências antecipadas em `GRANT/REVOKE/ALTER FUNCTION`, comparando nome e assinatura com a ordem cronológica. O gate deve apontar que `20260821004409...sql` referencia RPCs ainda inexistentes. Não altere migrations nem código de negócio. Aceite: CI retorna arquivo, linha e assinatura; reset real é obrigatório; guardrail não pode concluir sucesso sem aplicar todo o histórico. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
