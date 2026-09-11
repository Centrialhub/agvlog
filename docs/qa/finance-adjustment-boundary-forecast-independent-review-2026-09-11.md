# Revisão independente — fronteira de ajustes e previsão

Achado confirmado e corrigido por root: o coletor anterior ignorava source_issue no snapshot do recebível. Descarga com devedor legado divergente possui requires_reconciliation=false porque não há diferença de soma, mas não deve ser projetada como origem conferida. A cláusula nova em 15916 exige source_issue nulo.

Teste independente cashForecastUnloadingSourceIssueReview.test.ts passou às 09:21:43: cria descarga pelo writer real, reproduz client_id legado divergente, restaura o guard antes de ler, verifica snapshot real mismatch/reconciliationfalse, instala coletor publicado capturado e observa validtrue/nominal15000; restaura o corpo corrigido e observa validfalse/nominalNULL. Suspender um guard exclusivamente durante a montagem do legado não prova escrita atual permitida; nenhuma função de snapshot/coletor foi simulada e não houve acesso remoto.

No restante do escopo lido, não identifiquei vazamento de DTO nem bypass concreto: 121356 chama require_access no dispatch/preview/catalog, preserva gerência no core, verifica eco da prévia e liga can_execute às permissões do dispatch e bloqueio do writer privado. DTO do contexto atual é construção explícita sem evidência privada; histórico seleciona campos públicos. Concessões são para authenticated, com raw writer sem concessões e checagem adicional de empresa e ator no cliente. Não considerei pins finais pendentes um defeito, conforme coordenação.

15916 preserva nominal, caixa e créditos separados de desconto/perda; restante deduz cada categoria uma vez e SQL/TS possuem validação da composição opcional. Agenda fica inelegível quando saldo residual é zero. UI distingue atual de preservado, oculta valores em erro/refetch e mantém metadados de identificação atual rotulados. Não realizei testes de concorrência nem certifiquei a cadeia remota.

Hashes de leitura (fontes em revisão, não certificado de release):
- supabase/migrations/20260911121356_finance_receivable_adjustment_public_catalog.sql: 7e6bf20bcbb11890b3217bc4fcdd1b459d015c8fce2d0476b617aad55750b436
- supabase/migrations/20260911115916_finance_cash_forecast_balance_adjustments.sql: 46fbae999b8230e14453294a5aa2ec36d7cb8e8c4d776f75ab973ab495bc946a
- src/test/cashForecastUnloadingSourceIssueReview.test.ts: ef84a68c5e1c84a3de5e217cce7ae92f83ef3a3bf397850ee9cac1329dfc446d
