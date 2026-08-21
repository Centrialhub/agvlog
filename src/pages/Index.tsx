/* Trabalhe somente no diagnóstico do estado real do banco vinculado; não altere migrations, schema, dados ou aplicação. Crie `docs/audits/stabilization-migration-state.md` registrando: versões aplicadas de `20260821004409` até `20260821021913` em `supabase_migrations.schema_migrations`; assinaturas existentes em `pg_proc` para writers de funcionário, carga, item e despacho; e colunas reais de `idempotency_keys`, `dispatch_trips`, `dispatch_stop_documents` e `vehicle_events`. Informe projeto, ambiente consultado e horário, sem expor segredos. Se não houver acesso ao banco vinculado, falhe explicitamente e não invente resultados. Não faça nenhuma outra mudança. Aceite: relatório contém consultas, resultados e conclusão objetiva sobre quais migrations históricas podem ou não ser editadas. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
