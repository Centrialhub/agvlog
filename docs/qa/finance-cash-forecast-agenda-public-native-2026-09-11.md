# Agenda financeira: fronteira pública e concorrência

Migração CLI candidata: `20260911100348_finance_cash_forecast_agenda_public_boundary.sql`.
SHA256 `bfaa2030c704be5bf3f832e2c687e30cc69a6e3ff745e6b530111d58fe1c89ce`.
Core revisado pelo agente de banco:94505 SHA `3ab38431ac00ba1f1affd80caf59eaf8433fa5f6372eeead9a447f70819ea081`. Esta tarefa não editou94505 ou94523, nem executou escrita remota, stage ou commit.

## API

`preview_finance_cash_forecast_agenda(_tenant_id uuid,_cutoff date,_period_end date,_economic_key text)` retorna o DTO privado normalizado de prévia, com tenant/ator/período/chave conferidos e `can_execute` condicionado à elegibilidade e ACL do dispatcher. O helper exige acesso financeiro atual; não há bypass para driver misto.

`record_finance_cash_forecast_agenda(_payload jsonb)` aceita o contrato94505: version1,tenant_id,request_id,economic_key,action set/clear,expected_on nullable,reason,expected_revision,cutoff,period_end. Retorno sem confirmed ou flags de dinheiro inventadas: version,tenant,actor,event,request,economic_key,action,expected_on.

Wrappers invoker e helpers seguros definer usam search_path vazio. Somente authenticated recebe EXECUTE dos quatro novos pontos de entrada; raw writer, prévia interna e journal permanecem privados. A promoção fixa 8 funções (incluindo auditoria central), volatilidade, definer/invoker, search_path e ACL; fixa preserve trigger completo e RLS/ACL do journal. Catálogo efetivo capturado em `finance-cash-forecast-agenda-core-catalog-2026-09-11.json`.

## Testes públicos

`npx vitest run src/test/cashForecastAgendaPublicBoundary.test.ts`: **5 passaram**, com parsers reais cashForecastAgendaPreviewSchema/ResultSchema. Lint do teste e helper nativo: saída0.

Prévia autenticada; set/replay/clear; vencimento original inalterado; revisão antiga40001; tenant/misto/anon/raw e replay revogado negados; dispatcher revogado desabilita can_execute; trigger WHEN false/eventos alterados impedem promoção; falha de audit append reverte journal inteiro e retry registra um único evento central.

## PostgreSQL17.11 nativo

`node --experimental-strip-types scripts/test-finance-agenda-native.mjs`: **6 passaram**, sessão60421 saída0. Cluster descartável em loopback parado; nenhum processo restante. O runner troca apenas transporte PGlite por psql persistente na factory real, observando bloqueio entre duas conexões antes de liberar o primeiro comando. Hashes de core, fronteira e94523 conferidos antes/depois.

1. Duas agendas com a mesma revisão: uma confirma; outra40001; replay não duplica; clear com nova revisão preserva sequência.
2. Revogação confirma durante espera pelo lock financeiro: reautorização42501 e nenhum evento.
3. Papel motorista inserido durante a espera: mixed driver42501 e nenhum evento.
4. Fonte muda antes da aquisição do lock financeiro: revisão antiga40001.
5. Writer mantém membership bloqueada até commit; revogação posterior impede replay.
6. Barreira **após a leitura STABLE real da prévia**, antes do segundo leitor do mesmo SELECT: outra conexão altera frete125.50→200. Journal guarda nominal12550 revisado; coletor após commit vê20000, agenda.stale=true e expected_on=null. Nenhum valor200 foi aprovado silenciosamente como se tivesse sido exibido.

A barreira do caso6 é instrumentação diagnóstica explícita: copia a prévia real para helper privado, preserva seu resultado, aguarda advisory lock e retorna esse resultado mantendo STABLE. Não simula sucesso ou dados de fonte. O corpo original é restaurado e seu MD5 conferido ao fim. A alteração do frete ocorre somente na fixture local já existente, sem emissão fiscal/provedor.

## Tentativas anteriores e limites

Sessão52478: erro de parser do harness (`auth.uid` mais count convertido em Number→NaN); corrigido para ler a última linha JSON. PostgreSQL encerrado.

Sessão50703: cinco provas passaram; a barreira usando receivable foi impedida corretamente pela guarda real205941 `finance_unloading_source_busy40001`. Não se removeu essa proteção. A hipótese de que o UPDATE de recebível comum estivesse livre nesta cadeia foi descartada; o ensaio final usou frete permitido na fixture para isolar o contrato MVCC de leitura coesa. Esse resultado não é ocultado como falha da agenda.

Fixtures usam writers/readers/guardas financeiros reais e adaptações de DDL fiscal já declaradas em cashForecastCollectorDatabase; não é ensaio de emissão fiscal, Auth hospedado ou navegador. O agente de banco entregou separadamente prova de integração da cadeia92319/94310/94523. Não se alega que todos os writers operacionais remotos foram executados nesta suíte.
