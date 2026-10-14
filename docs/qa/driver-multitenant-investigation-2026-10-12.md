# Investigação: conta de motorista compartilhada entre empresas

Apuração local em 12/10/2026, 20:11–20:23 UTC. Nenhum dado pessoal, credencial ou ambiente produtivo foi acessado. Sem WSL, Docker, infraestrutura compartilhada, exclusão/desvinculação real ou publicação.

## Resultado e limite

**Comprovado no código e em SQL executado:** uma conta legada com papel `driver` ATIVO em duas empresas recebe `driver_account_shared_or_other_role`, inclusive na consulta `inspect`. O handler converte o erro em HTTP 409 e as duas telas exibem a mesma mensagem. Não depende de outro papel, vínculo inativo ou ambiguidade na resolução do username.

**A proteção global deve permanecer.** Senha, identidade e exclusão Auth atingem todas as empresas. O modelo novo define cada conta gerenciada como pertencente a um único tenant. Não existe neste contrato uma conversão autorizada e sem desvinculação de uma conta legada compartilhada para o novo login. Retirar o guard não resolveria os demais constraints e abriria risco de tomada de conta entre empresas.

**Não reproduzido como defeito de cadastro local:** a atualização do nome em `drivers`, incluindo `user_id` e `tenant_id` inalterados como no payload atual, passa pelo trigger sem alterar a outra empresa. Este ensaio prova o comportamento do trigger; não aprova todas as políticas RLS ou o fluxo nativo publicado.

**Correção local limitada preparada:** a mensagem do guard deixa de orientar “Revise os vínculos antes de excluir o acesso” e explica que o cadastro é separado, proibindo exclusão/desvinculação para contornar o bloqueio. É uma correção de orientação; **não desbloqueia a migração/acesso multitenant** e não deve ser apresentada como solução integral do incidente.

## Identidade e coordenação

- Task: `driver-multitenant-investigation-20261012`; owner: `CodexDriverInvestigation`.
- Branch: `task/driver-multitenant-investigation-20261012`.
- Workspace: `F:/AGVLOG/work/driver-multitenant-investigation-20261012`.
- Base: `50b6fe92a5501aac9588eec7b88d47dc3a21cf38`, tree `365951219f38d2e63d7f00de80bc9995010a6ffe` conforme handoff. Preflight registrado confirmou HEAD/base e pin público `df6dfd513098ff8967256ae9a2bbad8118fa35cd`.
- O checkout `patch2-homologation-integrated-20261012` fornecido no handoff está efetivamente congelado em `013c1858c78ded26ae0a81bff91a6c06de9c5d0b`, tree `5e9bf2fbfdab139d87d24842936090757a27b540`. O estado do coordenador aponta `patch2-final-validation-v2-20261012` sobre `50b6fe92`. Não alterei nenhum desses checkouts ou a integração.
- Workspace criado com `agvlog.mjs new`; handler reservado posteriormente com `claim`; preflight `check` PASS antes de editar/testar. Somente três paths reservados: este relatório, o teste novo e `manage-driver-access/handler.ts`.
- Instruções lidas: `F:/AGVLOG/AGENTS.md`, README, AGENTS do checkout, `.agents/skills/audit-code-quality/SKILL.md` e documentos de estabilidade/baseline indicados. A skill local manda auditar sem modificar código; a autorização posterior explícita permite correção mínima local, sem refatoração ampla.

## Caminho causal e código

1. `src/pages/Drivers.tsx:430` e `src/pages/TeamManagement.tsx:1029` montam `DriverAccessControls`, por `driver_id` e `user_id`, respectivamente.
2. `src/components/drivers/DriverAccessControls.tsx:32–39` consulta `inspect`; erro vira alerta e botão de nova tentativa, antes do formulário de senha/criação.
3. `supabase/functions/manage-driver-access/handler.ts:24–33` exige JWT verificado, contexto ativo e membership efetiva `owner/admin` na empresa. Em `:87–92`, o driver é buscado por ID E tenant. Em `:99`, `inspect` chama o mesmo `getScope` usado por senha/retirada.
4. `supabase/migrations/20261005204938_driver_username_access.sql:64–89`: `private.driver_access_scope_v1` bloqueia qualquer membership em outro tenant, qualquer papel diferente de driver, workspace incompatível, vínculo portal, papel global incompatível ou driver em outro tenant. Não filtra `active` nas evidências de compartilhamento. `_retire=false` também percorre esse guard.
5. `handler.ts:42` traduz esse erro para `scopeMessage`, HTTP 409. Na base, a mensagem mencionava exclusão mesmo para uma consulta ou tentativa de senha.
6. `handler.ts:104` e `prepare_driver_access_v1` exigem motorista ativo e SEM conta vinculada. Criar outro login por cima da conta compartilhada também é recusado. O nonce/convite e criação Auth só ocorrem depois dessa validação.
7. `private.guard_driver_account_scope_v1`, mesma migration `:126–203`, impede novo vínculo legado de driver e limita conta gerenciada ao tenant da metadata derivada. `drivers` usa trigger em INSERT ou UPDATE de `user_id,tenant_id`. Mantê-los inalterados numa edição do cadastro legado é permitido.

### Identidade, cadastro e seleção de empresa

- `driverLoginEmail` transforma username normalizado em `username@usuario.com`, sem tenant e sem busca de “primeiro perfil”. `src/pages/Auth.tsx` passa esse e-mail diretamente a `signInWithPassword`.
- A conta Auth e `profiles.id` representam identidade global. `tenant_memberships` é único por `(tenant_id,user_id)`; `uq_drivers_tenant_user` é único por `(tenant_id,user_id)` quando o usuário não é nulo (baseline, linhas 18875 e 20500). Isso permite o legado em empresas distintas; não equivale à permissão de administrar sua identidade global.
- `Drivers.tsx:478–498` envia a atualização local com filtro tenant e CAS de `updated_at`. Esse caminho não chama `driver_access_scope_v1`.
- `TeamManagement.tsx:963–979` envia `full_name` a `update-team-member`; `supabase/functions/update-team-member/index.ts:123–136` grava `profiles.full_name` por ID global. **Este campo não é um nome local de membership.** No fonte examinado, essa operação não contém o mesmo guard de compartilhamento; não a trate como edição cadastral local nem amplie permissões em torno dela. A mensagem relatada sobre editar/excluir pode refletir bundle/contrato publicado diferente: falta reconciliação live.
- `useTenant.tsx:85–94` prioriza claim assinado validado contra memberships, depois preferência, e tem fallback preexistente para `memberships[0]`. Não criei nem usei esse fallback para resolver o incidente. A ativação posterior usa `set_active_tenant_context_v1` e refresh de claim. Revisar seleção explícita separadamente se o requisito de produto proibir esse fallback; não é a origem do 409 reproduzido.

## Versões

O diff `df6dfd51..50b6fe92` é vazio para:

- `supabase/functions/manage-driver-access/*`;
- `supabase/functions/update-team-member/*`;
- `supabase/functions/_shared/driverCredentials.ts`;
- `supabase/migrations/20261005204938_driver_username_access.sql`;
- `src/pages/Auth.tsx` e `src/pages/TeamManagement.tsx`.

Blobs Git nas duas revisões:

| Arquivo | Blob SHA-1 em ambas |
| --- | --- |
| manage-driver-access/handler.ts | `31473aa1f7a5347696c34fdae38d8b2218a07f63` |
| 20261005204938_driver_username_access.sql | `8c1a7378b35efc5ba38f84aedec5d478822bb713` |

Patch2 altera a entrada de criação de acesso em Drivers e a reconciliação/recuperação de respostas incertas em DriverAccessControls. Não altera o guard multitenant. Logo o mecanismo existe tanto no fonte patch1 quanto no candidato patch2; não é evidência de regressão introduzida por patch2.

O preflight consulta o release público, mas não verifica bundles Edge ou corpos SQL live. Portanto **não confirmo a versão Edge/SQL que atingiu o cliente**. A frase literal “não é possível editar ou excluir pois o usuário existe em mais de uma empresa” não foi encontrada no caminho examinado. Não presumo patch2 publicado.

## Reprodução e testes

Arquivo: `src/test/driverMultiTenantManagementRegression.test.ts`.

Usa fixture existente `setupDriverGraph` (PGlite 0.5.8/pgcrypto e predecessores reais de convite), sem rede, e aplica o forward inteiro `20261005204938`. Antes de instalar os guards, estabelece duas memberships ativas de driver e dois cadastros ligados à mesma identidade sintética. Nenhuma role privilegiada do alvo. O adapter do handler executa reads e a RPC nesse SQL; operações Auth são spies que lançam erro caso chamadas. A assinatura JWT é simulada depois de `getUser`, sem autenticação nativa.

Casos: recusa real da RPC; inspect por driver; inspect por membro; senha/retirada/criação substituta recusadas com grafo preservado; alteração local do nome preservando identidade/memberships/outro tenant; contraprovas de outro admin, ator driver, driver de outro tenant e claim/header divergentes; normalização global determinística de username.

Antes da correção da mensagem: **5 PASS, 2 FAIL**, ambos por ausência da explicação de separação cadastro/conta. Mensagem observada: “Conta compartilhada com outra empresa ou outro perfil. Revise os vínculos antes de excluir o acesso.” O teste não usa uma falha esperada da segurança como razão para retirar o guard.

Depois: **42/42 PASS em duas suítes** (7 novos + 35 `driverAccessHandler.test.ts`), duração 2,75 s, observado às 20:20 UTC. `git diff --check` PASS.

Comando executado no workspace próprio:

```powershell
node F:/AGVLOG/work/patch2-final-validation-v2-20261012/node_modules/vitest/vitest.mjs run --config C:/Users/Thomaz/Documents/Codex/2026-10-12/task/investigation.vitest.config.mjs --configLoader native --no-cache
```

Config local: um worker, sem paralelismo de arquivos, sem setup global, ambiente node, timeout 30 s, somente as duas suítes. Dependências existentes lidas por junction no workspace próprio; cache Vite redirecionado para o diretório desta investigação, cache Vitest desativado e config carregada nativamente. Nenhum processo, cache ou arquivo do checkout de QA foi modificado. Runtime disponível Node 24.19.0; o projeto declara Node 22: resultado local não substitui o gate de CI no runtime pinado.

Limites: fixture parcial, sem replay completo do baseline, sem RLS nativa/PostgREST/GoTrue, sem prova de concorrência entre sessões. O teste de edição local modela somente os triggers usando service_role; não deve ser apresentado como aprovação de permissão de navegador. Os testes existentes do handler complementam os cenários negativos, não tornam a prova nativa.

## Proposta mínima e impacto de segurança

O delta implementado só troca `scopeMessage` (uma linha de lógica textual). Preserva código HTTP, chamada SQL, seleção da empresa, grants/RLS/roles, credenciais, usernames e todos os vínculos. Nenhum efeito de autorização ou alteração de contrato RPC. Não substitui uma migração de contas compartilhadas.

Próximo candidato funcional, se a coordenação aprovar o desenho: separar uma **inspeção somente leitura**, validada por membership/driver LOCAL e permissões efetivas, das capacidades de alteração global. Retornar estado restrito sem listar empresas externas ou identidade de outros tenants; UI mantém cadastro local independente e explica limitação. Não basta transformar todo `shared_or_other_role` em sucesso: o erro atual também cobre alvo sem vínculo local, e isso criaria um oráculo de identidades. Manter revalidação no servidor para cada mutação global, mesmo após consulta bem-sucedida.

Habilitar username para uma conta legada multitenant exige decisão explícita: suporte à identidade global compartilhada com fluxo do próprio titular e autorização adequada, ou modelo aditivo de acesso por tenant sem sobrescrever/desvincular o cadastro histórico. O contrato atual `drivers.user_id`/metadata não oferece essa conversão. Não implementar escolhendo primeiro tenant, apagando vínculo, trocando email/senha global como admin local ou removendo guards.

## Handoff / pendências

1. Coordenação: leitura mínima de metadata de deploy para versões e hash do bundle completo de `manage-driver-access` e `update-team-member`; metadata/assinatura/hash `md5(prosrc)` de `public/private.driver_access_scope_v1` e `private.guard_driver_account_scope_v1`. Se divergirem, revisar fonte sanitizado. Sem linhas de usuários, auth.users, logs com payload, emails, senhas ou tokens.
2. Distinguir a ação efetiva do cliente: abrir gerenciamento de acesso, salvar nome local em Drivers, salvar `profiles.full_name` em Equipe ou tentar migração/exclusão. A mensagem já foi solicitada; não houve nova exigência ao cliente nesta investigação.
3. Revisão independente antes de qualquer integração. O delta de mensagem é seguro e revisável, mas **não satisfaz sozinho a demanda de converter acesso compartilhado**. Aprovação específica é necessária para alterar política/modelo global; não foi inferida da autorização de corrigir defeitos locais.
4. Native e gate completo permanecem com o operador responsável. Nenhum enqueue, integrate, push ou deploy executado. Checkout da investigação preservado para revisão.

Bloqueios registrados: Git sob sandbox retornou Permission denied na leitura de F:/AGVLOG; a leitura e o workspace coordenado foram posteriormente aprovados por auto-review, sem negativa pendente. Tentativa de enviar achado à thread de origem via API local retornou `thread not found`; não houve envio confirmado nem contorno. Changelog markdown Supabase não pôde ser renderizado pelo navegador (content-type); a referência oficial de [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) foi consultada; nenhuma API Supabase foi alterada.
