# Complemento em aberto: concorrÃƒÂªncia PostgreSQL nativa

Ensaio local concluÃƒÂ­do com PostgreSQL17.11, loopback e cluster descartÃƒÂ¡vel. SessÃƒÂ£o33870: saÃƒÂ­da0, sete casos executados, cluster parado e PID removido. Nenhuma conexÃƒÂ£o a banco configurado do aplicativo ou escrita remota. MigraÃƒÂ§ÃƒÂµes81653 e83307 permaneceram congeladas; hashes conferidos antes e depois, registrados no JSON acompanhante.

Runner novo: `scripts/test-finance-open-complement-native.mjs`. Casos: `scripts/test-finance-open-complement-native-cases.mjs`. Fixture: `src/test/helpers/openComplementNativeFixture.ts`. O transporte persistente psql foi extraÃƒÂ­do do runner anterior de devoluÃƒÂ§ÃƒÂµes, sem alterÃƒÂ¡-lo. As factories TypeScript reais foram empacotadas com esbuild, substituindo somente o cliente PGlite pelo transporte PostgreSQL; writers, readers, triggers e constraints continuam reais. Todos os processos filhos sÃƒÂ£o encerrados no finally, inclusive quando hÃƒÂ¡ falha.

## EvidÃƒÂªncia das duas sessÃƒÂµes concorrentes

O helper contested observa bloqueio real em pg_stat_activity/pg_blocking_pids nos caminhos que aguardam. Nos caminhos NOWAIT, mantÃƒÂ©m a sessÃƒÂ£o proprietÃƒÂ¡ria aberta atÃƒÂ© confirmar a rejeiÃƒÂ§ÃƒÂ£o imediata da concorrente.

1. Pagamento real de50 segura o grafo primeiro. A correÃƒÂ§ÃƒÂ£o baseada na prÃƒÂ©via antiga aguarda, recebe40001 apÃƒÂ³s o commit e nÃƒÂ£o gera amendment. Pagamento50 e custo150 permanecem.
2. CorreÃƒÂ§ÃƒÂ£o150Ã¢â€ â€™120 segura o grafo primeiro. O pagamento concorrente antigo50 ÃƒÂ© recusado; obrigaÃƒÂ§ÃƒÂ£o20 permanece pending. ReaprovaÃƒÂ§ÃƒÂ£o explÃƒÂ­cita e novo pagamento real20 funcionam, com custo verificado e reserva original100 inalterada.
3. AprovaÃƒÂ§ÃƒÂ£o primeiro altera a revisÃƒÂ£o. A correÃƒÂ§ÃƒÂ£o concorrente antiga ÃƒÂ© rejeitada40001, preservando a obrigaÃƒÂ§ÃƒÂ£o50 aprovada.
4. AprovaÃƒÂ§ÃƒÂ£o genÃƒÂ©rica em espera pelo row lock da correÃƒÂ§ÃƒÂ£o atua sobre a obrigaÃƒÂ§ÃƒÂ£o corrigida20 depois do commit. O custo continua verificado. Esta ÃƒÂ© uma observaÃƒÂ§ÃƒÂ£o do contrato existente, nÃƒÂ£o uma rejeiÃƒÂ§ÃƒÂ£o por versÃƒÂ£o: esse caminho de aprovaÃƒÂ§ÃƒÂ£o nÃƒÂ£o recebe expected_revision. Portanto nÃƒÂ£o se pode afirmar que toda aprovaÃƒÂ§ÃƒÂ£o iniciada antes de uma correÃƒÂ§ÃƒÂ£o exige uma nova confirmaÃƒÂ§ÃƒÂ£o de prÃƒÂ©via. Nenhum pagamento antigo50 ÃƒÂ© autorizado por isso.
5. MaterializaÃƒÂ§ÃƒÂ£o real do acerto possui a viagem primeiro. A correÃƒÂ§ÃƒÂ£o falha rÃƒÂ¡pido40001/NOWAIT e o snapshot de custo150 permanece; uma nova prÃƒÂ©via continua inelegÃƒÂ­vel devido ÃƒÂ  materializaÃƒÂ§ÃƒÂ£o.
6. CorreÃƒÂ§ÃƒÂ£o possui a viagem primeiro. O builder concorrente falha55P03/NOWAIT. ApÃƒÂ³s o commit, o retry real materializa o custo120, mantendo a reserva100.
7. SessÃƒÂ£o com row lock prÃƒÂ©vio da obrigaÃƒÂ§ÃƒÂ£o provoca40001 na correÃƒÂ§ÃƒÂ£o, sem mutaÃƒÂ§ÃƒÂ£o parcial de valor, versÃƒÂ£o ou dinheiro.

ESLint dos trÃƒÂªs arquivos novos: saÃƒÂ­da0 sem diagnÃƒÂ³sticos. NÃƒÂ£o houve TSC, build, alteraÃƒÂ§ÃƒÂ£o SQL ou deploy nesta rodada. Duas tentativas iniciais do harness foram corrigidas antes da execuÃƒÂ§ÃƒÂ£o final: conflito de nome local com esbuild; movimento de pagamento da fixture sem driver_id exigido pela obrigaÃƒÂ§ÃƒÂ£o. Ambos os clusters dessas tentativas foram encerrados; nenhum guard foi desabilitado para fazÃƒÂª-las passar.

## Limites e sequÃƒÂªncia

Esta prova cobre o complemento positivo e ainda nÃƒÂ£o pago. O alvo menor ou igual ao jÃƒÂ¡ alocado continua exigindo uma coordenaÃƒÂ§ÃƒÂ£o separada de cancelamento da obrigaÃƒÂ§ÃƒÂ£o e disposiÃƒÂ§ÃƒÂ£o do excedente. AprovaÃƒÂ§ÃƒÂ£o genÃƒÂ©rica sem revisÃƒÂ£o esperada ÃƒÂ© uma ressalva concreta a considerar na liberaÃƒÂ§ÃƒÂ£o. O ensaio nÃƒÂ£o afirma verificaÃƒÂ§ÃƒÂ£o do navegador/Auth hospedado nem de todas as interaÃƒÂ§ÃƒÂµes operacionais de produÃƒÂ§ÃƒÂ£o.
