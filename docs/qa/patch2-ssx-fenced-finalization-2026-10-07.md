# PATCH 2: finalização SSX com token de posse

Task `patch2-ssx-dependencies-20261007`, owner `CodexPatch2`, branch `task/patch2-ssx-dependencies-20261007`. Base congelada `42c1e0a5bd0c4f06179c0c83cd7b512378eff6fd`; este delta é uma proposta local separada para o integrador. Nenhuma aplicação de migração, serviço compartilhado ou publicação foi realizada.

## Problema e contrato

O achado `PATCH1-A7-SSX-CONCURRENT-VIOLATIONS-001` é P2 operacional. A contraprova local sobre42c observou duas chamadas fake ao provider antes do primeiro ACK. O commit11bc15e adicionou exclusão durável por conta, mas a revisão adicional reproduziu um risco residual: um proprietário suspenso além do lease podia voltar e escrever um ACK de erro antigo sobre o cooldown do proprietário seguinte. Timeout do cliente não comprova cancelamento no banco. A contraprova está em `ssx-late-owner-before.json` na pasta de trabalho de07/10; não demonstra dano produtivo.

O contrato v2 reúne upsert, ACK e finish em uma única transação SQL. `commit_ssx_rule_violation_window_v2` bloqueia o checkpoint da conta e valida status, token e validade pelo relógio do servidor antes de tocar o cursor. Em seguida bloqueia o cursor e valida sua posição esperada; executa os contratos v1 de upsert e ACK; confirma o finish com o mesmo token ao final. Se o lease expirar durante as escritas ou o ACK falhar, uma exceção desfaz todos os efeitos da transação. `fail_ssx_rule_violation_window_v2` usa a mesma verificação antes do ACK de erro e do finish. Token ausente, antigo, expirado ou de outra conta não autoriza escritas.

Ordem de locks: checkpoint → cursor → violations. Um segundo claimant espera o checkpoint e observa o estado final da transação. O handler conserva Auth/tenant/workspace/role/capability/token antes do claim, o formato de sucesso/idle/partial/erro existente e a janela incremental. A concorrência da mesma conta devolve deferred/requests0; contas distintas permanecem independentes. O limite de30s para provider e timeout10s do transporte Supabase reduzem a ocupação; a proteção de escritas depende do SQL v2, não desses limites. Lease órfão permanece running até expirar. Falha na finalização tenta somente o finish v1 tokenizado, sem ACK separado; falha de release informa502.

## Dependências SQL e compatibilidade

- `20260910163922_add_ssx_governance_and_violations.sql`: tabelas e `get_ssx_rule_violation_window_v1`, `upsert_ssx_rule_violations_v1`, `ack_ssx_rule_violation_window_v1`.
- `20260924143248_add_ssx_sync_checkpoints.sql`: checkpoint e `claim_ssx_sync_checkpoint_v1`, `finish_ssx_sync_checkpoint_v1`, lease90s.
- Novo forward local `20261007122904_fence_ssx_rule_violation_finalization.sql`: apenas duas funções v2, security invoker/search_path vazio, execução restrita ao service_role já existente. Não substitui funções v1 nem altera seus grants, tabelas, policies ou assinaturas.

O teste compara OID, corpo, ACL, proconfig e security definer das cinco funções v1 antes/depois do forward. O filename foi gerado pela CLI Supabase2.116.0 no diretório de rascunho próprio, com perfil isolado e telemetria desativada; nenhum comando DB foi executado. `SET LOCAL lock_timeout/statement_timeout` no arquivo limita a sessão que aplica a migração, não constitui configuração de timeout de cada RPC.

## Evidência e limites

O fixture PGlite carrega os dois forwards existentes e o novo SQL, executa RPCs como service_role e importa duas instâncias reais do handler; Auth/capability/leitura de conta e todo HTTP são sintéticos. Há verificações de mesma conta, contas distintas, dedupe/replay, Retry-After7200, rejeição antes do claim, idle, limite local, finalização/release indisponível, proprietário tardio, recuperação de lease órfão, ACL v2 e rollback conjunto de upsert/ACK por falha ou expiração induzida dentro da transação.

`fenced-working.json`:26 PASS/0 FAIL em três arquivos, incluindo retry legado e três regressões source-map. ESLint dos quatro arquivos de código/teste alterados passou sem warnings. Estes são resultados da árvore de trabalho anterior ao commit final; o handoff registra os gates executados depois no SHA exato.

PGlite serializa comandos em memória: ainda falta verificar corrida em múltiplas conexões PostgreSQL, permissões reais/PostgREST e execução Deno. Não houve prova WS Realtime, restauraçãoA13, seis casos SQL agenda negados, nova janelaA7 nem chamada externa SSX. A revisão independente do integrador/revisor permanece requisito de promoção; esta revisão adicional foi realizada pelo próprio autor.

## Ordem de promoção e retorno, sujeita a aprovação

Antes da promoção, o integrador precisa registrar/revisar este novo forward nos manifests de baseline e release, confirmar os contratos v1 no alvo e validar a árvore combinada. A preparação local não autoriza aplicar SQL.

Sequência proposta: aplicar e verificar as funções v2; interromper temporariamente o despacho de violations e aguardar/drenar workers antigos; publicar o handler v2; reativar o despacho e observar lease/cursor/cooldown/replay. O esquema antigo não suporta o handler v2. Workers v1 em voo continuam capazes de ACK sem fencing e não ficam protegidos pela simples presença das funções novas.

Retorno proposto para revisão: suspender o despacho, drenar todos os consumidores v2 e conservar funções v2, checkpoints, tokens/leases, retry_at e cursores sem reset ou migração destrutiva. Um handler de retorno precisa continuar consultando o gate e o cooldown do cursor; o commit11bc15e fornece esse caminho com os contratos SQL v1 existentes, mas só é aceitável como contingência controlada após drenagem e com despacho serializado, porque mantém a limitação de ACK sem fencing. Verificar o mesmo cooldown e a mesma posição antes/depois do retorno e não reativar enquanto houver lease ou retry vigente. Retornar diretamente ao42c pode ignorar cooldown que existe somente no checkpoint e não é um retorno compatível aprovado. O plano depende de revisão/ensaio nativo; não há promessa de rollback automático seguro. Não remover funções nem modificar bundles históricos automaticamente. Não há alteração fiscal neste pacote.
