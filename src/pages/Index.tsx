/* Parta da versão 9, não da versão 10. Trabalhe exclusivamente em `MANIFEST.sha256` e `supabase/migrations/MANIFEST.sha256`; nenhum outro arquivo pode mudar. No manifesto raiz, acrescente em ordem cronológica as migrations `20260821020512`, `20260821020545`, `20260821020910` e `20260821021913`, usando prefixo `supabase/migrations/`. No manifesto interno, acrescente somente `20260821021913`, sem prefixo. Calcule os SHA-256 dos arquivos reais; não copie valores sem validar. Não edite, renomeie ou regenere migrations, scripts, testes, frontend ou configuração. Ao final execute `python3 scripts/guardrails/migration-integrity.py` e apresente o código de saída. Antes de concluir, mostre `git diff --name-only`; ele deve listar exatamente os dois manifestos. Se qualquer outro arquivo mudar, reverta-o. Aceite somente com 281 migrations registradas em ambos, sem ausências, extras, duplicatas ou hashes divergentes. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
