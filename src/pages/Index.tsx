/* Trabalhe somente na higiene de configuração e segredos. Remova `.env` do versionamento e adicione `.env` ao `.gitignore`; crie `.env.example` apenas com nomes de variáveis e valores vazios/seguros. Adicione `scripts/audit-secrets.sh` ao CI para bloquear service-role keys, JWT privados, senhas, tokens e chaves fiscais em arquivos rastreados, exibindo somente caminho e nome do padrão, nunca o valor. Permita apenas variáveis públicas necessárias ao Vite, sem tratar chave publishable como segredo privado. Não altere código da aplicação nem imprima o conteúdo atual do `.env`. Aceite: auditoria falha com fixture de segredo, passa no repositório limpo e `git ls-files .env` não retorna resultado. */
import { Navigate } from 'react-router-dom';

const Index = () => {
  return <Navigate to="/dashboard" replace />;
};

export default Index;
