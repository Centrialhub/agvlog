# Coletor privado de previsão de caixa — 2026-09-11

## Entrega local

`20260911082303_finance_cash_forecast_private_collector.sql` cria `finance_private.cash_forecast_collect(uuid,date,date)` e os helpers privados `forecast_movement_evidence` e `forecast_customer_credit_evidence`. Não cria wrapper público, título, emissão fiscal, movimento, forecast persistido, grant a usuários ou cron. O chamador privado ainda exige `finance_private.require_access` para empresa e ator atuais. Nenhuma aplicação remota nesta tarefa.

Contrato: `src/lib/financial/cashForecastCollectorContract.ts`, export `cashForecastCollectorSchema` / `CashForecastCollector`. DTO v1 específico do coletor; o adapter do root produz a base multicontas v2. Não representa reconstrução comercial histórica. A leitura é um snapshot operacional atual da empresa inteira, com corte monetário explícito anterior ao dia corrente de São Paulo.

## Fontes e tratamento

- Base por todas as contas da empresa, inclusive contas legadas/inativas com histórico: fechamento ativo terminando no corte, validado por `period_money_account`; na ausência, abertura validada por `account_opening`. Abertura exatamente no início do dia seguinte é confirmada; reconstrução posterior com movimentos anteriores é provisória. Conta sem prova permanece null; tipo desconhecido permanece `unsupported`. Banco e caixa mantêm IDs próprios, sem UUID agregado inventado.
- Recebíveis existentes: `_receivable_financial_snapshot`, validação de valores/status/data e chave `receivable:id`. Pagos e nominal separados. Dados inválidos não viram zero.
- Obrigações: `payable_portfolio_evidence` e `payable_effective_cost_evidence`; nominal histórico, pagamento ativo e custo econômico não são somados como caixa nem confundidos.
- Fretes: `unbilled_freight_rows`, sem valor de mercadorias e sem inferir vencimento. Documento autorizado/reservado não vira uma segunda expectativa disponível. Vínculo legado ambíguo com título é diagnóstico do cenário expandido. Descarga é excluída apenas da detecção de duplicação de título de frete, preservando a distinção econômica.
- Fatos fiscais `pending/review`: observação e revisão da fila geram bloqueio de cobertura confirmada sem promover protocolo ou valor. Assim fatos capturados ainda sem título não desaparecem da previsão.
- Caixa após corte: somente IDs de `active_movements`, cada perna uma vez, sem adicionar novamente extrato, bank_transaction ou pagamentos. A prova de origem usa `movement_recording_origin` para o registro manual e as cadeias de comando/evento/IDs/conta/dia/valor para recibos, devoluções e transferências em par ou trânsito. Um órfão permanece no bruto, acompanhado de issue global. Movimento pós-datado legado vira diagnóstico; o comando atual já rejeita criação futura.
- Crédito cliente: preservado separadamente e não atribuído a outra obrigação. A validação requer recibo/banco exatos, ausência de reversão/correção, snapshot com IDs coerentes, origem/título cancelados e observação da mesma emissão. Crédito incompleto torna o total null. Mesmo válido, crédito ainda sem destinação gera issue global; não reduz dívida presumidamente.

A revisão inclui valores/fontes retornados, provas das bases, snapshots dos títulos, créditos e origens/observações, além de hashes dos estados de fretes e da fila fiscal. `captured_at` não participa do hash. A função é STABLE: cada chamada usa a visão consistente da instrução SQL; não usa max(sequence) como revisão.

## Validação

`src/test/cashForecastCollector.test.ts`: 10 casos SQL reais mais 1 em `cashForecastCollectorCredit.test.ts`, parser e `projectCollectedCashForecast` reais. Última suíte integral: 11 PASS, 0 falhas, aproximadamente 4,5s. ESLint dos quatro arquivos TypeScript novos: 0.

Provas: ACL anon/authenticated/service_role sem execute direto; empresa alheia e motorista misto negados;1005 NF completas e total101505 centavos de frete; recebimento canônico5000 sobre título15000, com um movimento e fulfilled5000; abertura bancária10000 e base mista banco10000+contagem20000; fechamento real/reabertura muda proveniência para provisória; paid sem prova/NaN/crédito órfão retornam null; fila fiscal review mantém issue e altera revisão ao mudar o motivo; comando real nega dinheiro pós-datado.

Falhas encontradas durante implementação e corrigidas: alias PL/pgSQL conflitando com conta do movimento; validação numérica precisava preceder conversão de snapshot do recebível. O primeiro teste de fechamento ficou corretamente bloqueado por fila de reconciliação pendente; passou após executar o worker real da fixture, sem contornar guarda.

## Limites

Fixture compõe comandos/leitores monetários, aberturas, contagem, reconciliação e fechamento reais. Fontes fiscais e tentativas usam DDL original com FKs operacionais externas omitidas e campos de predecessor explicitados. Não há funções simuladas retornando sucesso. O teste não é uma reprodução integral do Supabase/Auth/Storage/Hub e não prova autenticidade externa de extratos. O teste separado de crédito instala lifecycle fiscal e executa seu worker financeiro real sobre fatos sintéticos de provedor: CTe100 recebido junto com outro título50 no mesmo movement150; cancelamento gera crédito100 validado, mantendo1movement150,2bank_transactions100+50 e2payments byte-a-byte. Isso confirma que igualdade bank_transaction.amount=credit.amount preserva recebimento compartilhado, sem exigir igualdade ao movimento150. Não chama emissão/provider nem trata sua escrita de fatos sintéticos como integração externa. Aplicação futura do crédito em outro título permanece fora desta entrega; a pendência está explícita. O coletor não foi executado em PostgreSQL nativo nem em produção nesta rodada. Nenhum arquivo histórico ou snapshot fechado foi alterado.
