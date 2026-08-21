/* Trabalhe somente em `src/test/ciProbatory.test.ts` e em helpers de teste estritamente necessários. Remova `expect(true).toBe(true)`, retornos antecipados, aceitação de `fetch failed` e qualquer teste que passe com backend ausente. Use exclusivamente o Supabase local iniciado pelo CI; crie por service role dois tenants, usuários autenticados A/B e registros reais, depois prove que: o backend responde, anon não executa writers protegidos, usuário A não lê nem altera registros de B e DML direto revogado falha. Limpe as fixtures ao final. Não altere migrations, RLS, RPCs ou aplicação para acomodar o teste. Variáveis, CLI ou banco ausentes devem falhar. Aceite: cada cenário possui asserção positiva e negativa e o arquivo falha deliberadamente quando a URL local é inválida. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
