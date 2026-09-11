# Previsão de fretes não faturados —53731

Migration local criada via CLI: `20260910153731_finance_unbilled_freight_summary.sql`. Nenhuma aplicação remota, transmissão fiscal ou transação bancária.

## Contrato

`get_finance_unbilled_freight_summary(_tenant_id,_from=null,_to=null,_client_id=null)` retorna v1, filtros, basis=per_nf_freight, date_basis=invoice_issue_or_attempt_recorded_date, expected_receipt_date=null, coverage_complete=false. Contagens: total_origins, available/reserved/uncertain/authorized/review/cancelled_count, undated_count. forecast_cents é string inteira ou null. groups por estado e months por mês com origin_count e forecast_cents. diagnostics conta cada problema (uma origem pode ter vários).

`list_finance_unbilled_freight_origins` recebe os mesmos filtros mais `_state=null,_page=1`. Retorna total e até30 rows em ordem document_id/attempt_id, v1/filtros/página. Linhas: document_id, attempt_id, client_id, origin_date finita ou null, date_basis, state, freight_cents e issues. freight_cents na linha é valor declarado do frete original, não inclusão automática na previsão. Tentativa sem preço próprio tem null.

## Semântica

Disponível usa exclusivamente fiscal_documents.freight_value validado, nunca value/mercadoria, net_value de CTe nem totalValue do pool. Uma linha por NF original e por tentativa adicional. A data é emissão da NF; tentativa usa dia São Paulo do registro. Sem data prevista de recebimento ou vencimento comercial inventado.

Fontes fiscais por IDs: reservas de produção; CTe/NFSe com fiscal_document_ids; vínculos explícitos da NF com documento emitido; observações fiscais imutáveis preservando arrays históricos. Joins usam EXISTS, evitando multiplicar a NF por catálogo/reserva/observação. Emissão autorizada comprovada retira a NF da disponibilidade; emissão pendente fica reservada; envio in_flight/uncertain é incerto. Preparação não enviada sem emissão não é autorização.

Rejeição sem autorização anterior libera disponibilidade quando os demais critérios continuam válidos. Cancelamento fiscal não prova cancelamento do serviço nem seu preço remanescente, portanto exige revisão. Documento operacional cancelado/excluído não compõe previsão. Histórico continua rastreável mesmo após retirada dos arrays correntes do catálogo, usando a observação original.

Reentrega não herda preço original: alinhado com closingAttemptPreview e _build_closing_items, nova tentativa é unpriced_redelivery. Claim comercial ativo por NF/tentativa impede reutilizar o frete inteiro sem revisar parcelas. Mais de uma autorização, marcador sem fonte, cobertura legada não confirmada, identidade duplicada, pagador/data/frete inválidos e resultados returned/refused/partial_delivery/not_delivered exigem revisão. Qualquer origem review dentro do filtro torna nulos todos os totais/grupos; não apresenta subtotal como carteira completa.

## Limites explícitos

Não implementa uma política nova de preço de reentrega, custo proporcional por mercadoria, reabertura comercial automática após cancelamento, nem rateio inferido de CTe global sobre subconjunto de NFs. Não confunde quantidades de origens autorizadas com valor financeiro ainda a receber. Cobertura fiscal parcial ou claim comercial sem parcela comprovada permanece revisão, até existir decisão auditada de serviço/parcela.

A consulta se baseia no universo inbound do billing pool, com controles adicionais de integridade. Não é previsão de todos os serviços fora de NF nem inclui descarga. As linhas retornadas permitem identificar pendências, mas nenhuma nova mutação de resolução foi criada. Títulos autorizados e recebimentos continuam nos resumos próprios.

## Validação

Dez testes SQL PGlite passaram em `financeUnbilledFreight.test.ts`; todas as respostas passam nos schemas reais de UI (resumo/lista). Inclui1005 NFs, diferença frete/mercadoria, produção autorizada/pendente/incerta, rejeição/cancelamento, observação histórica após limpar arrays atuais, dados indefinidos, duplicidade/autorização ambígua, paginação31, motorista misto, reentrega via comandos auditados reais, claims de fechamento real, reservas por ID e ausência de criação de movimentos. ESLint passou. Rerun final após integração do contrato UI passou em12:49; SHA256 da migration `fcc7dfe4f8d73ad0f4681a81b8b016887cf1f0339a8a72d7bfa2229b35135dc0`.

Fixture reutiliza cadeia operacional/financeira real e fiscal observation/projection. A tabela de reservas é fixture estreita para leitura; mudança de status simula evidência já recebida pelo produto, sem chamar provedor remoto. Não é ensaio de envio fiscal nem de carga de produção. A comparação de elegibilidade ocorre em snapshot de leitura único; nenhuma trava ou mutação monetária é necessária.

Validação independente PostgreSQL17 final: oito testes passaram no mesmo hash,1005 NFs/34 páginas/IDs exatos, reservas/rejeição, observação imutável, claim/liberação e retorno/tentativa sem preço. Cluster descartável encerrado. Detalhes em `finance-unbilled-freight-native-2026-09-10.md`. Nessa suíte nativa claims/tentativas foram semeados como fontes de leitura; os comandos operacionais reais foram exercitados na suíte PGlite acima, não na nativa.
