# PATCH 2 AGVLOG — escopo e backlog inicial

Sessão CodexPatch2, 2026-10-07. Task `patch2-ssx-dependencies-20261007`, branch `task/patch2-ssx-dependencies-20261007`, worktree `F:/AGVLOG/work/patch2-ssx-dependencies-20261007`.

Base confirmada pelo coordenador: `42c1e0a5bd0c4f06179c0c83cd7b512378eff6fd`, tree `0e6d2a61dfd4a652cb928284e93f875af5d6f8d8`. Integration ancestral `deda6fd1fa765648f8de1785a1a7693081ad11bb`. Pin público lido pelo preflight `63278f7ef77dd1c4e0db7d9e7219ca48280ee18a`. Patch 1 permanece congelado; seu revisor exclusivo conclui a homologação. Nenhum PASS de patch 1 será atribuído ao patch 2.

Paths inicialmente reservados: `supabase/functions/ssx-sync-rule-violations/index.ts`, `src/test/ssxRuleViolationConcurrentRuntime.test.ts`, `docs/qa/patch2-scope-and-acceptance-2026-10-07.md`. Ampliações exigem claim explícito. Nenhuma reserva `**`; o integrador controla mesclagens.

## Requisitos e aceite incremental

| Prioridade | Frente / requisito | Aceite / riscos / estado inicial |
| --- | --- | --- |
| P0 | SSX violations: excluir chamadas simultâneas da mesma conta antes do cooldown | Reproduzir no handler original com transporte fake. Testar duas instâncias do handler sobre SQL real isolado; uma consulta, segunda deferred/requests0; cooldown até Retry-After; contas independentes; replay/dedupe e cursor/CAS; erro/readfail fail closed. Usar lease existente service_role, sem novos grants/schema. Limitar tempo do HTTP abaixo dos90s do lease. Ainda não corrigido no início. |
| P1 | Dependências herdadas: quatro raízes históricas,13high/5moderate | Conferir fontes atuais oficiais por pacote; escolher delta mínimo e validar lock/consumers/build/lint/cobertura no SHA novo. `source-map-js1.2.2` e família `typescript-eslint8.48.0` são candidatos históricos, não decisão atual. Sem audit externo: a transmissão do manifest/lock foi negada. Sem auditfix cego, major forçada, downgrade/suppression ou presumir dev seguro. |
| P1 | Forge fiscal | Pin independente da Edge; proposta de versão/proveniência, impacto no parser/certificado e ensaios sintéticos antes de qualquer edição. **Não tocar** emissão, shared fiscal ou Deno pin nesta sessão sem autorização específica. |
| P1 | Regressões reproduzidas encaminhadas pelo revisor | Backlog com severidade, SHA/alvo, reprodução e teste preventivo. Acesso cruzado, perda/duplicação e falha persistente têm prioridade. Não converter lacuna em bug. |
| P2 | Realtime | Revisar código/fixtures isolados e harness inerte. Aceite runtime WS101/join/frame/UI antes de polling e tenant/actor exige aprovação própria. Polling não é prova WS. Réplica/serviços pertencem ao revisor. |
| P2 | Recuperação / CI / A13 | Revisão estática e testes puros de guards/artefatos; preservar contrato de quatro camadas e retorno compatível. CI hospedado, baseline nominal/restore e novos acessos continuam condicionados. Não reabrir janela expirada. |

## Autorizações e bloqueios conservados

Código e testes isolados próprios autorizados. Zero requests SSX externos: orçamento3/3 esgotado. Não executar audit externo negado nem outra rota que transmita inventário; não rerodar seis casos SQL agenda negados. Não iniciar runtime Realtime, novas credenciais, janelaA7 ssx_enabled ou restoreA13. Não publicar/push/mesclar, aplicar migrações, alterar dados/configuração produtiva ou tocar serviços/réplica do revisor. Memórias são histórico, não autorização. Sem tokens/senhas em artefatos.

## Evidências consultadas

- `C:/Users/Thomaz/Documents/Codex/2026-10-01/task/post-patch-preparation-20261007/README.md`.
- `task-2/dependency-audit-20261006/{REPORT-ad5ff718.md,BASELINE-EXPOSURE-63278f7-ad5ff718.md,INVENTORY-ad5ff718.json}` sob o mesmo prefixo de01/10.
- `task-3/ROOT-42C-INTEGRAL-19-CRITERIA-REVIEW-20261007.md`, `ROOT-42C-CONTINUATION-A7-AGENDA-20261007.md`, `ROOT-42C-PUBLICATION-DEFERRAL-AND-POSTDEPLOY-CHECKLIST-20261007.md`.
- Handoffs42c de `task/merge-20261006/invoice-fixture-civil-date/handoff-42c1e0a5/candidate.json` e `invoice-final-gates/evidence-42c1e0a5/candidate.json`.
- AGENTS do coordenador/repo/Vault; `01 Memoria/Contexto geral.md`; contexto AGVLOG e notas próprias históricas dependências/Realtime. Skill local audit-code-quality encontrada, somente audit; sem refatoração ampla invocada.

## Ambiente e próximos passos

Instalação inicial offline usou Node24/npm11 do PATH e foi refeita com Node22.23.2/npm10.9.4 locais, sem scripts/audit/network. Lock preservado. Testes usarão apenas Node22.23.2 e módulos próprios.

1. Selar contraprova de concorrência no42c; corrigir lease/limite de tempo em delta pequeno; executar teste de SQL/handler e contratos originais.
2. Conferir fontes públicas atuais de dependências sem transmitir manifest/lock. Implementar somente deltas com provenance/cache/compatibilidade verificáveis; manter riscos residuais explícitos.
3. Consumir achados reproduzidos do revisor; acrescentar deltas separados. Preparar handoff SHA/tree/testes/limites e sessão própria no Vault, sem editar índice compartilhado.

## Primeiro delta SSX preparado

Achado reconciliado: `PATCH1-A7-SSX-CONCURRENT-VIOLATIONS-001`, severidade **P2 operacional**, no handoff `task-3/PATCH1-42C-FINDING-SSX-CONCURRENT-VIOLATIONS-TO-PATCH2.json`. Prioridade inicial P0 da tabela indica a ordem de implementação desta sessão, sem elevar a severidade do incidente. Não foi demonstrado dano grave produtivo.

Contraprova própria: `C:/Users/Thomaz/Documents/Codex/2026-10-07/task/ssx-concurrency-before.json`, handler42c original em duas importações, SQL existente executado em PGlite e HTTP inteiramente fake. Esperado1fetch, observado2. A primeira execução ampla de preparação (`ssx-before.json`) também inclui sete expectativas do futuro gate ainda inexistente e um defeito do mock capability vazio; foi conservada, sem tratá-la como oito defeitos de produto. Mock corrigido e contraprova de concorrência selada separadamente.

Delta: acquire de `rule_violations_gate` pelo contrato existente `claim_ssx_sync_checkpoint_v1`, depois de Auth/tenant/role/capability/token e antes do cursor/window/HTTP; liberação confirmada via `finish_ssx_sync_checkpoint_v1`, maxAge0 para preservar polling incremental. Tempo monotônico de30s para provider I/O e timeout10s por transporte Supabase deixam margem no lease SQL90s. 429 preserva o código original no cursor e registra retry separado no checkpoint; falha de ACK mantém o cooldown no gate. Lease não confirmado fica running até expirar e a resposta reporta502. Os códigos e o formato success/idle/partial/502 originais permanecem; nova concorrência devolve200/deferred/requests0. Falhas comuns recebem o backoff conservador do contrato de checkpoint existente, sem advance do cursor por falha. Nenhum novo SQL, grant, tabela ou pin fiscal.

O fixture original de retry recebeu somente quatro linhas para o transporte mock das duas RPCs existentes; assertions e nomes intactos. Novo teste verifica duas instâncias, contas distintas, replay único, cooldown7200, ausência de fetch na negação capability/Auth/claim/window, idle, limite de tempo, falha de ACK e release não confirmado. Os testes checkpoint originais continuam verificando ACL/RLS/invoker, token stale, reclaim de lease expirado, erro e backoff.

Limites: PGlite serializa o acesso SQL em memória; esta prova não é teste de corrida em múltiplas conexões PostgreSQL nem Auth/PostgREST/Deno reais. A7 Native continua com o revisor/aprovação próprios. Antes de promoção, confirmar os dois contratos checkpoint no alvo e compatibilidade do bundle Edge, observar timeout/cursor/replay/lease e ensaiar retorno. O bundle histórico de violations preserva a limitação de concorrência; retorno ao código antigo reintroduz esse risco. Nenhuma edição do bundle histórico foi feita.

Paths adicionais declarados e reservados: `src/test/ssxRuleViolationsRetryRuntime.test.ts`; para o delta seguinte, `package-lock.json`, `src/test/sourceMapIndexedOffsets.test.ts` e `docs/qa/patch2-dependency-remediation-2026-10-07.md`. `package.json`, fontes fiscais, migrations e workflow remoto ficam intactos.

## Revisão do fencing e autorização local adicional

A descrição do primeiro delta acima registra11bc15e, não o contrato final. A revisão adicional reproduziu ACK tardio após expiração do lease; margens de timeout não constituem fencing no servidor. O coordenador autorizou preparar um forward SQL somente local e testar em banco sintético próprio. Foram reservados explicitamente `supabase/migrations/20261007122904_fence_ssx_rule_violation_finalization.sql` e `docs/qa/patch2-ssx-fenced-finalization-2026-10-07.md`. A finalização v2 reúne upsert/ACK/finish em uma transação com token e relógio SQL; preserva funções/ACLs v1. Ver o documento de finalização para dependências, testes, limites e sequência proposta de promoção/retorno. Nenhuma aplicação SQL, alteração de baseline compartilhado ou publicação foi autorizada/realizada.

## Transferência gerenciada de 07/10

O registro acima preserva o histórico do candidato anterior. Implementação atual na task patch2-ssx-loads-reconciled-20261007, base6f6361ce reconciliada com df6dfd publicado; port de bytes verificados e seis hashes de custódia confirmados. Old WIP encerrado/preservado, fonte8d congelada. A primeira rodada própria na nova base executou54 testes isolados PASS/0FAIL de SSX e source-map; resultado de working tree, posteriormente substituído por gates no SHA exato do handoff. D-P2-SSX-FENCE, D-P2-SSX-VOLUME/CT-SSX-R1, D-P2-SSX-RETURN/CT-SSX-R2 e D-P2-SOURCE-MAP. D-P2-IMPORT/CT-IMPORT-GROUP e CT-PROD-AUD-INGESTION-SCOPE documentados no registro específico de agrupamento. Nenhuma aplicação dos dois forwards ou bundle, publicação ou execução externa foi realizada.
