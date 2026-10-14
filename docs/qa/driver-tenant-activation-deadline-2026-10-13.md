# Prazo e recuperação da confirmação de empresa — 2026-10-13

Candidato local para revisão. Corrige a espera sem limite reproduzida no diagnóstico `a7beb4117b2c363c2a5b2317f396944b303465e5` (tree `ca1207bcd8d5db3092dcb2661ca087f8b0513e9a`). Não atribui esse mecanismo ao incidente produtivo sem a tela/etapa relatada. Task `driver-tenant-activation-deadline-20261013`, owner `CodexDriverTenantDeadline`, criada por `fork-frozen`, preservando o diagnóstico congelado. Integração `50b6fe92a5501aac9588eec7b88d47dc3a21cf38` e candidato combinado `3e1cdd30` não foram modificados.

## Mudança

`src/hooks/useTenant.tsx` passa a controlar cada tentativa de ativação, com auxiliar `src/lib/tenant/tenantActivationAttempt.ts`:

- **10 segundos totais por tentativa**, incluindo validação inicial da sessão, cancelamento de queries, RPC de ativação, renovação do token e eventual rollback já existente. O orçamento não reinicia em cada etapa.
- Timeout mostra erro explícito, **Tentar novamente** e **Sair**. Durante a confirmação existem **Cancelar** e **Sair**. A saída só altera a sessão se o Auth confirmar; falha de sign-out mantém a tela bloqueada.
- Interrupção aborta requisições compatíveis com AbortSignal, invalida a geração da tentativa e limpa o header de empresa ativa. Promise.race encerra a espera mesmo se o transporte ignorar abort.
- Uma tentativa expirada/cancelada não confirma sucesso, não grava uma seleção tardia, não inicia refresh/rollback tardio e não limpa o header confirmado por uma tentativa posterior.
- Evento SDK tardio de token válido pode atualizar a sessão do SDK, mas não abre automaticamente o conteúdo após timeout/cancelamento: exige recuperação explícita daquele ator. A marca de bloqueio sobrevive a erro/revalidação das memberships; novo login/ator recebe seu próprio contexto.
- Retry valida novamente a sessão e a claim assinada, exige destino presente nas memberships conhecidas e usa o RPC autoritativo conforme o fluxo existente. Não escolhe tenant para contornar ambiguidade; não muda regras de username/e-mail, roles, RLS, schema ou contratos RPC.

O helper mantém apenas estado efêmero da tentativa. Timers são encerrados em sucesso, cancelamento, troca de contexto e desmontagem. O cleanup passivo só limpa o header que ainda lhe pertence, ou seu escopo durante desmontagem; isso evita que a tentativa antiga apague a confirmação obtida pelo retry.

## Contraprova e validação

Node **v22.16.0**; jsdom, AuthProvider/TenantProvider reais, transporte SDK simulado, JWTs sintéticos, rede bloqueada, envDir vazio, um worker. Nenhuma conta, banco ou serviço real.

- **Base: 0 PASS / 13 FAIL / 0 SKIP**, `baseline-deadline-node22`: ausência de deadline, cancelamento, saída e abort do trabalho pendente.
- A primeira implementação revelou duas falhas reais de retry (limpeza antiga apagava header novo), corrigidas e preservadas em `corrected-deadline-node22`.
- Casos posteriores de sincronização/seletor do harness foram corrigidos sem relaxar assertions; logs de todas as execuções permanecem preservados.
- **Final: 69 PASS / 0 FAIL / 0 SKIP**, seis arquivos, `final-verified-deadline-node22`.
- **ESLint --max-warnings0 e TypeScript direcionado PASS**, recibos `lint-sealed-node22` e `types-sealed-node22`.

As 16 novas contraprovas em `tenantActivationDeadline.test.tsx` cobrem: timeout passivo em RPC e refresh; orçamento total entre etapas; retry após timeout e cancelamento; Cancelar; Sair e falha de sign-out; novo ator; timeout nas quatro etapas da troca explícita (validação, ativação, renovação, rollback); role/contexto alterado; desmontagem; token tardio passivo e da empresa de destino; recuperação das memberships sem liberar conteúdo antes da reconfirmação.

O conjunto também conserva os testes existentes de Auth/sessão e isolamento assíncrono em StrictMode. O witness do diagnóstico agora exige recuperação no prazo, preservando a reprodução antiga no commit base. O teste estrutural de sessão expirada foi adaptado ao await com prazo e exige índice encontrado, evitando que `-1` produza um falso positivo na verificação de ordem.

Harness/recibos: `C:/Users/Thomaz/Documents/Codex/2026-10-12/task/tenant-activation-deadline`. Execução: invocar o Node22 com `run-tests.mjs <nome-novo>`; o runner recusa sobrescrever logs. Antes de testar/editar no worktree, executar o check do coordenador para esta task/owner.

## Segurança, impacto e limites

A mesma confirmação é usada por telas internas e pelo app motorista; o limite também protege trocas explícitas dessas telas. Caminhos normais de troca para operator/driver/owner em StrictMode permanecem cobertos. Acesso offline previamente autorizado conserva o comportamento anterior, exceto que uma tentativa já expirada/cancelada não é liberada automaticamente só por mudança de conectividade.

**Abort do cliente não é rollback transacional.** Uma RPC já recebida pode ter sido efetivada no servidor. Após timeout/cancelamento o resultado é incerto, a UI não presume sucesso e o retry reconfirma o contexto. Não foi implementado cancelamento servidor-side nem alterado o hook de token. Native deve conferir abort/commit, eventos reais do SDK, duas sessões e ordenação de requests; isso permanece com o integrador.

Nenhuma compatibilidade de e-mail/username, cadastro de motorista, deleção, vínculo, dados, credencial, role, RLS, migration ou Edge foi alterada. Sem CLI Supabase, WSL/Docker, Native, build completo, integração, deploy ou publicação. Testes focados não conferem aceite Native nem gates combinados.

## Revisão e handoff

Revisar especialmente o bloqueio após evento tardio, a propriedade do cleanup e o efeito do timeout em commit de RPC incerto. Ensaiar no Native com atores sintéticos: atraso/drop de ativação, refresh e rollback; cancelar/sair; retry; login B enquanto A conclui tarde; duas sessões/empresas; não exibir conteúdo sem claim/membership confirmadas. Não alterar fonte congelada nem rodar esse ensaio em produção.

Handoff externo `DRIVER-TENANT-ACTIVATION-DEADLINE-HANDOFF-20261013.json` fixa commit/tree, paths/blobs, resultados e hashes. Commit apenas pelo coordenador; freeze formal do sucessor, revisão independente e eventual composição pertencem ao integrador. Nenhum novo ajuste depois do handoff.
