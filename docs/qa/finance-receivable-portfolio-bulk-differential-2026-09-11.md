# Carteira em lote: revisão diferencial e benchmark independente

## Resultado

Nove testes passaram em08:47:48 (sessão80515, exit0); lint0. Oito cenários comparam o DTO inteiro da nova função com cópia exata da função publicada, MD5 57b41ad9b959e236163ecb2e2cc590ac. Um teste valida fixture e catálogo. Parser real receivablePortfolioSchema também valida respostas.

Cobertura:10mil títulos e cancelados; corte diário SãoPaulo; infinito/data inválida; zero/null/projeção recebida sem prova; totals/status_rows null quando qualquer título inválido; recebimento40 e estorno40 reais; crédito600/refund200/aplicação400 reais; vínculosinvoice/closing/CTe ausentes; fatura e acerto coerentes com recebimentos reais40+60; tenant/filtros/motorista misto. Grafo positivo foi semeado com metadados coerentes como estado prévio e recebeu pagamentos pelo writer real, sem gerar documento fiscal.

Contraprova: mudar tax_id cadastral preserva identidade histórica corretamente, não deve invalidar refund. Minha expectativa inicial de invalidade estava errada; old e new já eram equivalentes. Remover audit é rejeitado por finance_immutable_record (guarda não desativada). Alterar estado da origem fiscal de cancelled para active na fixture isolada invalida crédito e ambos agregados retornam null global. Nenhuma contraprova em produção.

A fixture completa precisava da tabela closing_report_history para writer de pagamento em acerto. Restaurada DDL original da baseline somente no helper independente, sem stubs de sucesso e sem alterar fixtures publicadas. Primeiras falhas de preparação (roleoperator para reversal, UPDATE identidade imutável, closing_number e tabela histórica ausentes) foram corrigidas no teste, não no produto.

## Benchmark nativo

Sessão3295, PostgreSQL17.11 descartável, exit0, cluster parado. Mesmo dataset10mil títulos manuais de100 e20clientes, mesmos índices principais capturados; baseline anterior preservada. Controle escalar no MESMO banco:15.398ms aquecimento e15.530ms leitura seguinte. Nova carteira:20amostras após aquecimento, p95142,38ms; cliente500 p9522,06ms. EXPLAIN ANALYZE global119,58ms,185sharedhits,0sharedreads e0TEMP; antigo14.160,73ms,860.185sharedhits e usoTEMP. Total10mil e100.000.000centavos confirmado.

Limites: benchmark é local single-session/fixture, não p95 produção/E2E/concorrência. Dataset manual vazio de histórico não mede cardinalidade de invoice/closing ou concentração de créditos; JOINs OR de grafos podem ser próximos pontos de perfil em dataset representativo. Os testes funcionais cobrem esses ramos, mas não sua carga volumétrica.

## Rastreabilidade de freeze

PG instalou candidata SHA f6b52860bb86ecf320b0c7780226a0135487ef1a21c2a02042ec176bcf4e3e22. Durante execução o autor acrescentou pin do ledger combinado, antes de receber aviso de não editar; essa colisão foi comunicada. Não alegamos instalação nativa do hash novo: e948a5d8592dbfc5fb8b559b9adccefec7eb456b5c302e9657a8971f3ec84a3a. O corpo medido de summary, capturado no JSON nativo, tem MD5 cd10de42b2e3a1567dc2de034048e7f0, idêntico ao corpo final; somente guard adicional mudou. O hash final passou os nove testes PGlite após essa alteração. Script de reprodução aponta agora ao hash final. Nenhum SQL de produto editado por este revisor e nenhuma aplicação remota.

Arquivos-base e medições estão no allowlist agregado finance-receivable-portfolio-bulk-review-allowlist-2026-09-11.json. A mensagem genérica do transporte sobre zero functional gaps cobre contagem/valor, não homologação de latência.
