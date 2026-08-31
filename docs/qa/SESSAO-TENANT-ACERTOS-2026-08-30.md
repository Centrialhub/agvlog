# Sessão, tenant e listagens de acertos

Estado: correção local, ainda não publicada. Não declara o aplicativo pronto para produção.

## Reproduções e correções

Os testes dos providers reais reproduziram sete falhas antes da correção: resposta inicial de sessão sobrescrevendo logout/troca de conta; cache financeiro mantido entre contas; saída recusada sem aviso; memberships/papel mantidos no logout; escolha de tenant ausente dos acessos; reaproveitamento de consulta sem tenant na troca de empresa.

A tela real de acertos, integrada às funções SQL do repositório, reproduziu mais três falhas: listagem do operador reaproveitada por um motorista; registros e totais antigos mantidos após consulta recusada; resposta com registro de outro tenant aceita pelo cliente. Isso comprova as falhas nas reproduções locais, não um acesso histórico indevido em produção.

Dois testes adicionais reproduziram confirmações/justificativas globais abertas sobrevivendo à troca de conta ou tenant. A confirmação estava fora da árvore da página protegida.

- `AuthProvider` aceita eventos mais recentes sem permitir que o bootstrap atrasado os sobrescreva; limpa QueryClient na mudança de identidade e remonta os consumidores. Logout recusado é comunicado, sem fingir sucesso. Finalização atrasada de uma tentativa de logout não limpa a conta que a substituiu.
- `TenantProvider` consulta memberships por ator, cancela leituras obsoletas, valida o contrato de resposta e distingue ausência de acesso de falha de consulta. Não chama métodos Auth dentro do callback de Auth. A leitura operacional e o fallback do portal têm um limite conjunto de oito segundos.
- Troca de ator, tenant ou papel invalida dados e estado transitório antes de montar a nova tela, inclusive queries legadas sem chave de escopo. Renovação normal de token com o mesmo acesso conserva o rascunho e revalida memberships. Preferência de tenant é versionada por ator e nunca concede autorização.
- Confirmações ainda não enviadas são canceladas; promises de confirmar/justificar retornam `false`/`null`, e texto/callbacks anteriores são removidos. Uma confirmação legítima permanece aberta numa renovação normal do mesmo contexto.
- Comandos duráveis já enviados não são apagados. Cancelar a leitura ou desmontar a tela não significa cancelar uma transação já enviada ao servidor; continua obrigatório recuperar o pedido original por tenant/ator.
- Listagem e filtros de acertos incluem tenant e ator na chave, propagam cancelamento e validam respostas. Linha de outro tenant, valores inválidos e totais inconsistentes não são exibidos. Erro não é apresentado como zero ou lista vazia; atualização explícita recupera a consulta. Diálogos e filtros são reiniciados na troca de contexto.
- Não houve alteração de RPC ou migração neste bloco. Os leitores financeiros existentes continuam impondo papel/tenant/MFA no banco. O frontend não usa metadados editáveis do usuário para autorizar operações.

## Evidência

- `authSessionIsolation.test.tsx`: 20 testes aprovados, incluindo atrasos, cancelamento, timeout, armazenamento indisponível, StrictMode e confirmações globais.
- `settlementListFrontendDatabase.test.tsx`: 12 testes aprovados com a página/hook e SQL reais; filtros, erro, recuperação, mudança de contexto, MFA e tenant.
- `tenantMembershipFrontendDatabase.test.tsx`: 7 testes aprovados com provider e SQL reais; bootstrap de owner para MFA, portal-only, revogação, downgrade e falha explícita.
- Total focal: **39 testes novos aprovados**. Fixtures descartáveis PGlite, não uma stack hospedada completa de Auth/PostgREST/Storage.
- Regressão PostgreSQL 17.11: **290 cenários existentes aprovados**, processo código zero e cluster descartável parado. Nenhuma conexão de produção ou chamada fiscal nessa suíte. Não há cenário nativo novo neste bloco; os novos leitores usam SQL real nas fixtures integradas.
- Gate completo final: **2.399 testes em 203 arquivos aprovados**, tipos, lint, qualidade, 41 sintaxes Edge, build e inspeção pública aprovados, processo encerrado com código zero. Duração dos testes: 348,47 s; build: 19,85 s; maior chunk 488,3 KiB; index 363,4 KiB. Os hashes dos 12 arquivos de código/teste deste bloco foram comparados antes/depois da execução final. A primeira execução encerrou na tipagem por um import de teste não utilizado; import removido sem retirar teste ou relaxar limites.
- Uma execução intermediária não é aceita como gate: houve edições durante sua vida, apareceram 19 falhas de sessão e a investigação iniciou outra cobertura no mesmo diretório, causando `ENOENT` em arquivo temporário. Os 23 testes de sessão/diálogo da investigação passaram, mas a execução parcial naturalmente não atingiu os thresholds dos módulos de cobertura configurados. A causa isolada das 19 falhas não foi determinada nessa execução inconsistente. A execução completa final, sozinha e sobre arquivos estáveis, passou sem qualquer falha; nenhum threshold/teste foi removido.
- Cobertura configurada: 93,03% linhas/statements, 65,83% branches, 81,81% funções. Refere-se apenas ao subconjunto configurado, não à aplicação inteira.

## Produção, publicação e pendências

Leitura pública de Auth em **30/08/2026, 21:30:02 de São Paulo** (`2026-08-31T00:30:02Z`) confirmou **`disable_signup=false`** no projeto conhecido. Nenhuma configuração foi alterada. As ferramentas conectadas não expõem gerenciamento de configuração Auth; a CLI estava sem autenticação administrativa na verificação anterior. Foi solicitada autenticação por `supabase login`, sem envio de token/senha no chat. Não usar `config push` integral: o arquivo contém outras opções, inclusive opções potencialmente sujeitas ao plano.

A conexão suportada ao navegador foi revalidada e falhou antes do bootstrap (`windows sandbox failed: helper_unknown_error`). A skill Computer Use foi lida como alternativa, mas depende do mesmo runtime indisponível; não houve repetição nem tentativa de ler perfil/cookies/sessões por fora. Nenhuma página foi aberta ou alterada por essa tentativa.

Publicação exige release coordenada com os blocos anteriores: a árvore tem muitas alterações locais não publicadas. Não promover toda a árvore ou substituir arquivos sobrepostos cegamente. Após publicação, verificar login, logout, convite, recuperação, MFA, troca de tenant, portal, motorista, listagem/detalhe e recuperação de comandos em navegador autenticado.

Revisões ainda necessárias: ciclo integral de MFA durante mudança de assurance sem trocar de conta/tenant (o gate atual guarda `phase=ready` e precisa de reprodução específica), notificações globais, demais escritores privilegiados, fluxo financeiro integral e os demais P1/P2. Não há prova de E2E autenticado em navegador nesta etapa. As correções locais não encerram a política de convite hospedada nem demonstram revisão individual das funções privilegiadas restantes.

### Leitura de segurança de produção neste bloco

Advisors atuais: **140** avisos de [SECURITY DEFINER executável por authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), **1** de [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) e **3** informativos de [RLS sem política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). A quantidade não comprova exploração nem substitui a revisão individual.

A documentação oficial atual confirma que a proteção de senhas vazadas é oferecida no Pro ou superior. Não foi confirmado o plano contratado; habilitar somente se já estiver incluída sem cobrança extra. Não contratar upgrade para eliminar o aviso.

Uma consulta somente ao catálogo, delimitada a três tabelas e três papéis, confirmou que `application_error_events`, `application_web_vitals` e `secure_upload_rate_events` têm RLS ativo e zero políticas. Em todas, `anon` e `authenticated` não têm SELECT/INSERT/UPDATE/DELETE/TRUNCATE nem privilégios SELECT/INSERT/UPDATE em coluna. `service_role` possui apenas SELECT/INSERT/DELETE entre as operações verificadas. Os consumidores locais de observabilidade usam o cliente de backend. Portanto, não há acesso direto de navegador a essas três tabelas na configuração observada; não foi criada política permissiva para silenciar o aviso. Isso não audita automaticamente cada RPC/Edge que as utiliza.

Uma consulta agregada de compatibilidade encontrou **2 acertos existentes**: zero status não suportados, contagens inválidas, flags obrigatórias nulas, status de KM não suportados ou valores não finitos entre os campos verificados. Não foram retornados identificadores, nomes ou valores financeiros. É compatibilidade estrutural observada, não teste autenticado da tela publicada.

Sem emissão fiscal, pagamento real, scanner pago, aumento de plano, ativação SSX ou novo serviço. Os acessos remotos foram leituras: sinalizador público Auth, advisors, privilégios das três tabelas e contagens agregadas dos acertos; nenhum dado operacional foi alterado.

Skills: Supabase orientou callback Auth síncrono, validação no servidor e testes dos contratos reais; Postgres orientou a verificação de privilégios mínimos sem abrir RLS; React orientou remount por contexto e preferência local mínima/versionada. Referência de API: [eventos Auth](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
