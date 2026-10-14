# Diagnóstico de acesso ao app motorista — 2026-10-13

**Ainda não há causa atribuída ao incidente produtivo.** Há mecanismos locais reproduzidos e hipóteses discriminadas. O HTML público e os módulos de entrada estavam disponíveis por HTTP sem login. Nenhuma lógica produtiva foi alterada neste diagnóstico.

## Versão, URL e entrega pública

Às 17:02 UTC, leituras HTTP sem cookies/credenciais confirmaram `https://agvlogistica.vercel.app/release.json` com release **df6dfd513098ff8967256ae9a2bbad8118fa35cd**, buildHash `d043005c44f5d780`. O `builtAt` público é epoch e não foi usado como data de publicação.

`/driver`, `/auth?access=driver`, `/manifest.webmanifest`, `/sw.js`, entry `/assets/index--eqCDzIC.js`, suas 13 dependências diretas e `/assets/DriverHome-CA33T4xL.js` retornaram HTTP200 com MIME adequado. HTML de `/driver` e `/auth?access=driver` é idêntico (SPA). Manifest define `start_url=/driver`. Isso não comprova execução JavaScript, sessão, todos os imports transitivos ou funcionamento de um PWA instalado com cache antigo.

Tentativa no **navegador integrado do Codex (IAB)** falhou antes de abrir: runtime `MXC launcher: cannot locate required Windows platform directory: HRESULT 0x80070003`. A ferramenta web não acessou a URL. Fetch no sandbox retornou ENOTFOUND; a mesma leitura pública foi submetida à revisão de permissão e aprovada, então funcionou. Nenhuma negativa de auto-review foi contornada; não há observação visual/browser autenticado.

Base do workspace próprio: candidato congelado **3e1cdd30900da5a1d3c9922cc5ff67d3e3dfc6e6**, tree **c085125f50e227fac27fe8e69568c70c382b9f88**. Task `driver-app-access-diagnosis-20261013`, owner `CodexDriverAppAccess`. A comparação de blobs confirmou 14 arquivos idênticos entre patch1 e candidato: bootstrap, App, rotas, guardas, Auth, useAuth, useTenant, tenantMemberships, credenciais, cliente Supabase, useCurrentDriver, DriverLayout e rewrites Vercel. A Edge de gerenciamento mudou; não é chamada pelo formulário de login. O estado produtivo atual de Edge/SQL/hook Auth não foi consultado.

## Caminho e discriminação

| Etapa | Evidência/código | Como distinguir no relato |
|---|---|---|
| Bootstrap e roteamento | AppRoutes `/driver`; `DriverRoute` em `src/app/routeGuards.tsx:146` leva anônimo a `/auth?access=driver`; manifest aponta `/driver` | Tela branca/erro de arquivos antes do formulário sugere runtime/cache/chunk; não reproduzido em browser |
| Credencial nova | `src/pages/Auth.tsx:85` usa `driverLoginEmail`, derivando username normalizado no domínio interno; chama diretamente `signInWithPassword` | Nome novo funciona até o transporte Auth no mock; resposta GoTrue real não testada |
| Credencial legada | Campo de username rejeita e-mail antes da chamada Auth; selecionar “Painel e clientes” permite e-mail | Mensagem de formato antes de “entrar” discrimina incompatibilidade de modo; não atribuir isso a senha errada |
| Sessão | `useAuth` aceita eventos e limita bootstrap getSession a8s; Auth fetch/lock têm limites próprios | Aviso de serviço indisponível difere de falha de membership; casos existentes de coordenação/sessão executados |
| Vínculos | `readTenantMemberships` chama `get_current_memberships_v1`, com8s; erro oculta dados | “Não foi possível confirmar seus acessos” indica falha aqui; não escolher tenant arbitrário |
| Empresa assinada | `useTenant.tsx:126/132` chama `set_active_tenant_context_v1` e refresh; exige claim correspondente | Token renovado sem claim reproduz alerta “Não foi possível confirmar a empresa ativa…” |
| RPC sem conclusão | Mesmo trecho não tem prazo próprio para a ativação PostgREST | **Reprodução comprovada: “Confirmando empresa ativa” persiste além de60s**, sem erro/retry, quando esse RPC nunca resolve. Hipótese para o incidente, não falha produtiva observada |
| Cadastro operacional | `useCurrentDriver` chama `current_driver_id(_tenant_id)`, depois filtra drivers por id/tenant/active | Login pode funcionar sem registro resolvido; DriverHome mostra ajuda de falta de vínculo/cargas. Não confundir com indisponibilidade total |

A seleção respeita claim válido confirmado pelas memberships (teste com duas empresas passa). O fallback existente para primeiro membership e a ordenação do hook já existiam; não foram usados como correção de ambiguidade, nem alterados. Isolamento, roles e guardas permanecem intactos.

Menor informação externa necessária para atribuição: URL/origem e caminho usados, texto exato da tela, se o bloqueio ocorre antes ou depois de enviar login, se usa username novo ou e-mail legado (sem informar o valor), e se é navegador ou PWA instalado. Se for a tela de confirmação, coordenação pode obter apenas status/duração do RPC de ativação e presença booleana da claim esperada; **não enviar token, senha, headers ou dados pessoais**.

## Contrato do roteiro novo → legado → app

“Perfil antigo” precisa ser distinguido por entidade, sem inferir que seja o cadastro operacional:

1. **Novo acesso em cadastro independente + aposentadoria da conta legada distinta:** novo Auth/membership/workspace/driver deve permanecer byte-idêntico. Aposentadoria revoga memberships antigas antes do soft-delete GoTrue; falha no delete deixa acesso antigo revogado e permite retry. Cadastro/histórico antigo permanecem.
2. **Mesmo cadastro ainda vinculado ao legado:** criar novo antes de aposentar é recusado (`driver_unavailable_or_already_linked`). Caminho suportado para legado elegível é aposentar a identidade antiga, preservar cadastro/histórico e criar novo acesso nele.
3. **Conversão para username:** mantém a mesma identidade e vínculos existentes. Não existe uma identidade antiga independente para excluir; tentar aposentar a convertida como legado é recusado. Não reduzir a guarda para fazer o roteiro passar.
4. **Legado compartilhado entre empresas/outras roles:** aposentadoria continua recusada. A conversão autorizada no mesmo workspace é o caminho separado; não apagar vínculos para “desambiguar”.
5. **Botão “Remover motorista”:** `Drivers.tsx` envia DELETE ao cadastro. Não chama aposentadoria Auth. A contraprova mostra que remover cadastro legado pode deixar Auth/memberships antigos ativos, embora o novo acesso distinto sobreviva. Isso não satisfaz revogação de acesso antigo. O teste usa somente linhas sintéticas em PGlite.
6. **Conta gerenciada nova/convertida:** não pode ser removida/desvinculada como legado. A guarda SQL do candidato protege registry; não removê-la. Histórico conserva referência antiga deliberadamente; não é um órfão a ser apagado.

Pontos: Edge `manage-driver-access/handler.ts:196` revoga via scope antes de `deleteUser(userId,true)`; SQL `20261005204938_driver_username_access.sql` protege identidade compartilhada/nova e separa aposentadoria de cadastro. A migration `20261013025826_driver_native_link_registry_protection.sql` permanece herdada intacta.

## Reprodução e limites

Dois testes novos:
- `src/test/driverAppAccessDiagnosis.test.tsx`: sete discriminadores, componentes/provedor reais com SDK simulado, incluindo ausência de deadline da ativação.
- `src/test/driverAppAccessLifecycleDiagnosis.test.ts`: quatro casos executando funções SQL reais em **fixture parcial PGlite em memória**; sem GoTrue, sessões reais ou réplica.

Harness e resultados em `C:/Users/Thomaz/Documents/Codex/2026-10-12/task/driver-app-access`. Executável usado: Node **v22.16.0**. `run-tests.mjs` roda somente seis arquivos, um worker, rede bloqueada, env sintético e envDir vazio. O primeiro conjunto teve76PASS/1FAIL de sincronização do teste (capturava output transitório antes da confirmação); sincronização corrigida sem alteração produtiva. A execução direcionada posterior dos sete passou. Execução final: **77 PASS / 0 FAIL / 0 SKIP**, seis arquivos; ESLint sem warnings e tipos direcionados PASS. Resultados finais e lint/tipos ficam no handoff selado; não considerar testes que reproduzem comportamento ruim como aprovação desse comportamento.

Não houve build novo, deploy, mudança de banco/Edge/credenciais/roles/RLS, operação Native/WSL/Docker ou uso de pessoas/contas reais. Observação pública foi HTTP GET apenas. Qualquer proposta de timeout deverá preservar validação da claim, cancelamento por ator/contexto, retry seguro e não liberar o app sem escopo; não foi implementada sem correlação com o incidente.

## Aceite Native a cargo do integrador

Usar identidades sintéticas restauráveis, mantendo distinção A(nova) / B(legada) e UUID de cadastro:
- Abrir `/driver` sem sessão em navegador limpo e PWA: chegar ao formulário, sem chunk/CSP/runtime error; registrar release e browser.
- Criar A pelo fluxo novo; comprovar Auth, identidade email, membership driver ativo, registry e claim coerentes. Entrar e confirmar `current_driver_id` e role da empresa, sem ler outra empresa.
- Aposentar somente B elegível; comprovar registro/histórico preservados, memberships revogadas, Auth soft-delete; sessão antiga B não deve executar operações mesmo com JWT ainda não expirado. Repetir após falha de soft-delete simulada.
- Entrar novamente com A e sessão nova; comprovar dados/claims/vínculos de A intactos. No mesmo cadastro, testar ordem aposentadoria→criação. Na identidade convertida, provar recusa da aposentadoria.
- Testar duas empresas existentes e duas sessões: claim confirmada, isolamento, troca explícita quando suportada; nenhum primeiro tenant escolhido para esconder divergência.
- Navegar início/cargas/paradas/entregas/jornada/checklist/eventos/chat/despesas/carga/sincronização. Preparar dados sintéticos específicos para não confundir tela vazia com função indisponível. Validar permissões, vínculo operacional, gravações e replay offline conforme o contrato já planejado pelo integrador.
- Discriminar membership RPC com erro, refresh sem claim e ativação sem resposta, preservando mensagens e status mínimos; não limpar dados de PWA ou contas reais para fazer passar.

Este diagnóstico não confere aceite funcional Native nem causa final do incidente. Entregar SHA/tree pelo coordenador; candidato congelado e integração permanecem preservados.
