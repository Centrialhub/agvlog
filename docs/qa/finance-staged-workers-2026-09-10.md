# Rollout inativo dos workers financeiro — 2026-09-10

Preparados apenas localmente. Nenhum apply remoto, ativação, execução do worker, PG nativo ou TSC foi realizado.

## Artefatos e origem

- CLI criou 20260910224741_finance_fiscal_worker_staged.sql e 20260910225047_finance_bank_worker_staged.sql. Os arquivos vazios foram movidos para supabase/rollouts antes de receber conteúdo; não permanecem na cadeia fresh de migrations.
- Fiscal: origem integral 20260910012756_finance_fiscal_queue_worker.sql.
- Banco: origem integral 20260910022059_finance_automatic_reference_reconciliation.sql.
- Hashes SHA256 exatos em finance-staged-workers-hashes-2026-09-10.json neste diretório. O teste compara o conteúdo embutido ao arquivo original sem normalização e verifica seu hash.

Cada rollout é uma única instrução DO. A sequência exige APIs cron.schedule/cron.alter_job e catálogo cron.job, recusa qualquer job preexistente de mesmo nome, executa todo o SQL original (incluindo scheduler e ACL), encontra o job do usuário/database corrente, pausa com active=false e confirma nome, comando, frequência, dono/database, unicidade e estado inativo. Uma pausa com erro ou sem efeito aborta a instrução inteira. Nenhum agendamento ativo dessa instalação fica visível a outra transação antes da pausa confirmada.

Isso NÃO pausa nem regulariza instalação antiga já ativa: presença de job anterior aborta sem alterar o registro. Não há caminho de recuperação que sobrescreva outro job. O instalador precisa verificar previamente se existe execução anterior em andamento; estes artefatos destinam-se à primeira instalação, em implantação serializada.

## Condições de uso

Aplicar somente depois de todas as dependências da respectiva migration original, em sua posição lógica na cadeia. Staging desativa o agendamento; não torna inertes triggers, wrappers ou demais mudanças do original. Em particular, o bloco bancário modifica funções de conciliação e instala fila/trigger: sua ordem e compatibilidade continuam obrigatórias.

Não aplicar depois o original sobre esse mesmo banco (DDL se duplicaria). O escritor do rollout deve registrar a relação com a versão original em seu manifesto/histórico operacional. A cadeia fresh continua usando apenas os originais, sem esses arquivos de rollout.

A constante finance_private.can_access=false permanece intacta. Os workers não dependem dessa autorização para cron: por isso a pausa explícita é obrigatória. Não executar bootstrap/finance_fiscal_worker.sql nem bootstrap bancário durante a instalação incompleta, pois cron.schedule reativa o job.

## Ativação final, em etapa separada

Depois de verificar cadeia integral, runtime, permissões, escopo de workspace, fontes/filas e prontidão das integrações:

1. Ler cada cron.job por nome; exigir exatamente um, usuário/database esperados, frequência e comando originais e active=false. Conferir definição efetiva dos workers contra a cadeia final (migrations posteriores podem legitimamente modificá-los).
2. Conferir ausência de workers antigos em execução e filas/revisões conhecidas. Não executar lotes manualmente para contornar pendências.
3. Em transação própria da ativação final, usar cron.alter_job(jobid, active := true) nos dois IDs verificados, sem recriar/renomear jobs ou substituir comandos; confirmar ambos ativos antes commit. Caso algum requisito falhe, rollback mantém a pausa.
4. Observar job_run_details e as consultas de filas após o primeiro ciclo. A ativação de acesso financeiro deve usar a definição endurecida por workspace; nunca restaurar cegamente a versão original de can_access.

Os comandos originais preservados são:
- Fiscal: SET statement_timeout = '25s'; SELECT finance_private.run_fiscal_queue(50);
- Banco: SET statement_timeout = '25s'; SELECT finance_private.run_automatic_reconciliation_queue();
- Frequência de ambos: uma vez por minuto.

## Validação

src/test/financeStagedWorkers.test.ts: 10 testes passaram; ESLint passou. Para cada worker: preservação literal do SQL e scheduler, pausa confirmada/ACL/gate fechado, rollback após erro de pausa, rollback após pausa silenciosamente ineficaz, recusa de cron ausente e preservação de job preexistente.

PGlite executou os dois arquivos originais completos dentro do rollout. O cenário bancário instala suas migrations reais predecessoras; o fiscal usa tabela mínima de jobs porque este teste verifica instalação/atomicidade, não processamento fiscal. cron é uma fixture SQL mínima, não o daemon pg_cron: não demonstra execução assíncrona, compatibilidade da extensão remota ou funcionamento econômico da fila. Essas verificações pertencem ao ensaio integrado e à conferência read-only do destino pelo coordenador.

Primeira tentativa do teste falhou por nome de parâmetro da fixture can_access; corrigido para _tenant sem alterar o rollout. Rodada final saiu 0 com 10/10.
