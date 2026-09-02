# Login sem código autenticador — 31/08/2026

## Decisão e alcance

O usuário solicitou a retirada definitiva do código no login e confirmou
explicitamente a extensão às operações administrativas e financeiras após
ser informado do risco de comprometimento de senha.

O frontend não carrega mais a tela, hook ou fluxo de cadastro/desafio MFA.
A configuração versionada desabilita cadastro e verificação TOTP.
A migração `20260831164442_remove_authenticator_requirement.sql` substitui
17 funções para retirar somente a exigência de segundo fator. Também elimina
o helper de MFA que deixou de ter consumidores e verifica o catálogo para
recusar uma remoção incompleta.

Permanecem autenticação por senha, cadastro por convite, limites de sessão,
rate limiting, vínculo ativo, perfil, isolamento de empresa, RLS, grants,
regras financeiras, idempotência, varredura de uploads e auditoria.
Nenhum usuário, fator TOTP, sessão, arquivo ou dado financeiro foi apagado.

## Validação local

- 65 testes direcionados aprovados: login por senha com o SDK instalado e rotas
  reais, fatores existentes verificados/incompletos, logout, recarga da sessão,
  dados financeiros, despesas, ajustes, chat, uploads e Torre de Controle.
- 19 testes de configuração e 18 cenários adicionais de erro/recuperação financeira
  aprovados (102 testes direcionados no total). Mensagens de servidores antigos
  orientam atualizar a política de acesso, sem pedir um autenticador inexistente.
- As funções alteradas são executadas em fixtures PGlite com o SQL real;
  o teste compara grants, SECURITY DEFINER/INVOKER, search_path e volatilidade
  antes/depois e executa a verificação final de ausência de exigência AAL2.
- Controles negativos incluem acesso anônimo, senha inválida, ator forjado,
  outra empresa, perfil indevido, metadados editáveis e vínculo revogado.
- Typecheck, lint dos arquivos alterados, build e verificações do artefato público
  aprovados; sintaxe das 46 Edge Functions aprovada.
- Suíte geral: 2.731 testes aprovados e nove falhas preexistentes em cinco arquivos:
  driverDeliveryRollout (2), driverJourneyDatabase (1), driverDepartureDatabase (1),
  expenseMfaReleaseDatabase (4) e driverOccurrenceBackendContract (1).
  Todas foram reproduzidas exportando HEAD para uma cópia isolada, sem esta
  alteração (126 casos aprovados nos arquivos reexecutados).

## Publicação verificada — 31/08/2026

Após a reconexão, o projeto Supabase `qcvnsdrbcchaxvawcngk` respondeu normalmente.
A inspeção do catálogo mostrou que o banco hospedado já não exigia AAL2:
nenhuma função de aplicação nem política RLS com exigência MFA foi encontrada.
Os schemas privados de parte dos candidatos locais ainda não existem no destino.

Por isso, a migração local NÃO foi aplicada ao banco remoto: fazê-lo publicaria
dependências de outros recursos ainda não instalados. Ela continua versionada
para a sequência completa de migrações locais; não é uma pendência para liberar
o login na versão atualmente hospedada.

Foram publicadas as três Edge Functions preservando todos os arquivos hospedados,
exceto as verificações explícitas de MFA já removidas e testadas localmente.
A releitura confirmou conteúdo idêntico ao esperado, status ACTIVE e
`verify_jwt=true`. Versões observadas na verificação final:

- `secure-upload`: 9.
- `calculate-trip-route`: 57.
- `update-trip-live-status`: 57.

O frontend de produção está READY na Vercel:

- Commit: `4a3595a7919c812f08ddd91bc9f5bbf69a424546`.
- Deployment: `dpl_7hf4yzJ17hC8AH8NxN5LBhUxJqBc`.
- URL: https://agvlogistica.vercel.app/auth
- Bundle servido: `/assets/index-BsWgn2xe.js`, HTTP 200, sem os textos do
  formulário removido de cadastro/desafio do autenticador.

## Verificações hospedadas

- Transação somente de verificação, finalizada com ROLLBACK: memberships
  privilegiadas reais aceitas pelos helpers com claim `aal1`; tenant alheio
  rejeitado; ausência de usuário não expõe empresas.
- As três Edge Functions retornaram HTTP 401 para chamadas sem autenticação.
- Advisors executados: três avisos informativos de RLS sem políticas em tabelas
  de backend, 142 avisos SECURITY DEFINER e proteção contra senha vazada desativada.
  Nenhum schema, grant ou RLS foi alterado nesta publicação.
  Referências: [funções privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
  e [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

A configuração Auth hospedada de cadastro/verificação TOTP não foi alterada:
o conector não oferece essa operação. Isso não impõe segundo fator ao login;
não há mais gate no frontend, nas funções publicadas ou nas regras do banco.
Fatores e sessões existentes foram preservados.

Não foi digitada senha de usuário nem realizada uma nova entrada manual em uma
conta. A inspeção visual do navegador ficou indisponível por falha de inicialização
do sandbox; a verificação final usou o deployment Vercel, o artefato HTTP servido,
as funções hospedadas e os testes SQL transacionais.
