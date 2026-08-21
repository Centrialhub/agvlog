/* Trabalhe somente nos dois manifestos de migrations. Não edite nenhum arquivo `.sql`, script, teste, hook ou configuração. Calcule o SHA-256 dos arquivos atuais em `supabase/migrations/*.sql` e atualize `supabase/migrations/MANIFEST.sha256` e `MANIFEST.sha256` para conter exatamente todas as migrations existentes, uma vez cada, em ordem cronológica e no formato já usado por cada manifesto. Preserve os hashes das entradas já válidas; inclua apenas as ausentes, especialmente `20260821020512`, `20260821020545`, `20260821020910` no manifesto raiz e `20260821021913` em ambos. Aceite: nenhum `.sql` ausente, extra ou duplicado e `python3 scripts/guardrails/migration-integrity.py` passa. Não faça qualquer outra mudança. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
