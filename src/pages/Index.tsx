/* Trabalhe somente em `scripts/guardrails/migration-integrity.py`. Use `supabase/migrations/MANIFEST.sha256` como fonte canônica e valide também que `MANIFEST.sha256` possui o mesmo conjunto e os mesmos hashes, aceitando apenas a diferença do prefixo do caminho. O script deve falhar quando um manifesto faltar, tiver linha inválida, hash não SHA-256, arquivo ausente, extra ou duplicado, hash divergente ou ordem não cronológica. Remova a geração automática de manifesto e qualquer fallback verde. Não edite migrations, manifestos, frontend ou regras de negócio. Aceite: passa no repositório atual e falha em cópia temporária ao alterar, remover ou acrescentar uma migration sem atualizar ambos os manifestos. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
