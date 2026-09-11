# Comando privado de invalidação — PostgreSQL nativo — 10/09/2026

Script `scripts/test-finance-manual-movement-void-native-cases.mjs`, selector `finance-manual-movement-void`. Log `node_modules/.cache/qa-postgres/finance-manual-movement-void-native-2026-09-10.log`.

191905 SHA256 `6f57f662c965f24ccc010973232ea16b9ed44d0eed8480f0a47a72524237039b`, verificado por assert antes da instalação. A base instala90516 congelada,90635 e grafo real de período/cash/pagamentos.

## Casos

1. Comando privado executado como owner com `auth.uid` real: sucesso, replay idêntico, auditoria manual validada pelo schemaUI, ator/motivo, zero tickets residuais e registro original imutável.
2. Replay aguarda financeadvisory; autorização é revogada antes de liberar:42501/finance_access_denied, sem novo evento.
3. SessãoA segura linha do movimento; comando emB obtémfinance e falha NOWAIT:40001/finance_movement_correction_busy, sem void parcial ou deadlock.
4–6. Corridas com payablepolymorphic, transferência e partida, ambas as ordens: dependência primeiro invalida revision e bloqueia void; void primeiro faz writer concorrente falhar40001 e posterior retry falharfinance_movement_voided.
7–8. Alocação primeiro bloqueia void e preserva1000centavos; void primeiro bloqueia alocação concorrente e posterior, sem vínculo parcial.

O helper central `contested` ganhou opção opt-in `waitForBlocking:false`, mantendo default anterior. Nesse modo o holder confirma estar vivo/na transação antes de iniciar o waiter; aguardamos a rejeição imediata do waiter antes de liberar o holder. Isso permite provar NOWAIT/trylock sem confundir ausência de bloqueio com ausência de concorrência. Para caminhos bloqueantes segue obrigatório observar `pg_blocking_pids`.

## Limites

O comando continua privado, sem grants de execução à aplicação. Testes não concedem novos grants e não forjam tickets. Apenas dados de custo e vínculos de transferência de fixture são inseridos como owner; o comando de void é sempre real e todas as guardas relevantes estão instaladas. A fixture de alocação usa batch/item sintéticos válidos, não a tela de lançamento de custo.

As corridas de transfer/departure exercitam writers residuais de tabelas, não o fluxo completo operacional de transferências. Não há transação bancária externa ou alteração no extrato. Grafo focado herdado das factories; não é ensaio completo do deploySupabase. Nenhum SQLproduto alterado nesta rodada.

Resultado final: **8 testes passaram** em PostgreSQL17.11; handle55176 exit0, servidor parado. Rodada anterior9865 teve7 testes aprovados e exit0/stop antes de acrescentar a ordem inversa da alocação. Nenhum acesso remoto.
