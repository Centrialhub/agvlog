/* Trabalhe somente em `scripts/guardrails/ci.py`. Preserve os gates de integridade, linter e reset real, e acrescente `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, a suíte completa `bun run test` e `bun run build`; não execute apenas `ciProbatory.test.ts`. Cada etapa deve interromper o job no primeiro erro, imprimir o comando e preservar o código de saída. Ausência de Bun, Supabase CLI, Docker ou banco local deve falhar, nunca virar aviso ou sucesso. Não altere migrations, testes, TypeScript, regras ESLint ou aplicação para forçar verde. Não corrija nesta interação os erros descobertos: apenas restaure o pipeline e relate cada bloqueio. Aceite: o CI só declara sucesso após todos os comandos terminarem com código zero. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
