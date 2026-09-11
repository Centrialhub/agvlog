# Proteção da origem de descarga — PostgreSQL nativo

2026-09-10: **4 casos passaram**, PostgreSQL 17.11, sessão91601 saída0 e cluster encerrado. Migration205941 SHA256 `b8701c4f801c6840e3d37ce1ab048cc366a98f7c10be92adf3974d673e66ee09` conferido. Sem SQL de produto alterado ou operação remota.

Runner `scripts/test-finance-unloading-source-guard-native-cases.mjs`; seletor `PG_QA_SUITE=finance-unloading-source-guard`. Log `node_modules/.cache/qa-postgres/finance-unloading-source-guard-native-2026-09-10.log`.

1. Antes de instalar205941, writer real cria charge150; alteração então permitida ajusta título ainda sem pagamentos para151 e recebimento real registra100. Após instalar guard, novo receive falha sem acrescentar pagamentos/movimentos/transações/comandos. Refund real do original permanece permitido e recálculo resulta em recebido zero. Nenhum trigger desabilitado para construir esse legado.
2. Uma sessão segura título FOR UPDATE; INSERT de charge em outra sessão recebe40001 finance_unloading_source_busy pelo NOWAIT, sem40P01 ou charge residual.
3. Uma sessão segura advisory finance; UPDATE row-first em outra recebe40001 imediatamente, sem deadlock, preservando a descrição original.
4. Replay do record_unloading original espera finance; enquanto espera, ator perde membership. Após liberação, rejeita42501 antes de devolver replay.

Fixture restrita baseada em unloadingBankPackageDatabase; casos de conflito de INSERT usam candidato owner somente para provar rejeição antes da escrita, não substituem writer da charge positiva. Plataforma completa/Storage reais e upgrade integral permanecem fora do escopo.

Falha inicial45687 revelou trigger real de recálculo após reversão ausente da fixture. Coordenador corrigiu helper com recalc_receivable_after_reversal original183929. Rodada45329 interceptou instalação duplicada durante essa integração; fallback do harness foi tornado condicional. Ambas encerraram PG. Rodada final91601 repetiu os quatro casos com dependência real, sem alterar205941.
