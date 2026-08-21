/* Use exclusivamente o relatório `docs/audits/stabilization-migration-state.md`. Se qualquer migration problemática estiver aplicada no ambiente alvo, não edite histórico: encerre informando o bloqueio. Somente se o relatório provar que nenhuma delas foi aplicada, corrija a cronologia de permissões nas migrations de 21/08: cada `GRANT/REVOKE/ALTER FUNCTION` deve vir após a criação da assinatura exata; remova referências a assinaturas inexistentes como `update_load_v1(uuid,uuid,jsonb,integer)` e `delete_load_v1(uuid,uuid)` se não houver implementação real; não crie stubs. Atualize ambos os manifestos após os ajustes. Não altere lógica das funções, frontend ou flags. Aceite: `schema-check.py`, `migration-integrity.py` e `supabase db reset` passam integralmente em banco vazio. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
