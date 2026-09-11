# Atribuição de consumo com múltiplas aquisições

Implementação local 20260910171503_finance_stock_consumption_attributions.sql. Hash SHA256 `255b91a22d7e9dfe2a4bf43fa48c7c591d288d24976dc352cca653b57d58401c`. Nenhum banco remoto alterado.

Comando atribui uma peça/movimento consumption a linhas explícitas de aquisições. Soma exata de quantidades, aquisição única por linha, mesmo item/tenant, aquisição anterior ao consumo. O servidor calcula valores com remaining_balance_floor_v1: piso proporcional ao saldo ainda disponível; última quantidade recebe os centavos restantes. Linhas físicas de zero centavos são válidas. Snapshot guarda saldos anteriores/posteriores, política, origens, valores declarados e confirmação da divergência. Os valores operacionais permanecem intactos.

Aquisição já reconhecida continua sendo o único custo global. Nenhuma nova despesa, obrigação, pagamento, movimento bancário ou físico é criada. Registro de dependências reserva quantidade e centavos. Reversão append-only do cabeçalho libera exatamente reservas originais por IDs das linhas, condicionada em trigger ao evento de reversão persistido. Linhas e snapshots permanecem. Tentativa de DELETE direto da reserva sem reversão falha.

71503 também adapta a validação de preço unitário da aquisição para `round(quantity*unit_cost*100)=total_cents`, identificada no snapshot como rounded_extended_total_cents_v1. Isso permite documento de 1 centavo para 3 unidades com preço unitário subcentavo, sem exigir divisão decimal infinita. O total integral do documento/custo continua conferido; não se infere pagamento. A migration anterior70454 não foi alterada.

## Testes realizados

8 testes PGlite próprios passaram em financeStockConsumption.test.ts; os 8 de aquisição também passaram. ESLint passou. Casos: compra real1cent/3un e consumos0/0/1; reversão intermediária ou última sem recalcular história; quantidade física decimal; 10 filtros/R$1000 consumos2+3; várias aquisições; replay; origem trocando tenant; prévia obsoleta após outro consumo; declaração obrigatória de divergência; motoristas; segunda aquisição insuficiente sem reserva parcial; DELETE indevido de reserva. Todos os exemplos de aquisição usam record_finance_expense_batch e associate_finance_stock_acquisition reais.

Factory própria createStockConsumptionDatabase não altera fixture de aquisição em validação nativa. A concorrência PG real ainda será validada pelo agente de banco; esses testes não são apresentados como PG nativo.

## Contrato para integração

Private stock_consumption_preview(tenant,part,movement,lines) retorna revisão e cálculo completos; elegibilidade negativa mantém IDs/quantidades solicitados e issue, com attributed_cents nulo. Erro estrutural na seleção (vazia, IDs inválidos/duplicados ou quantidade não positiva) retorna22023. stock_consumption_reversal_revision(tenant,attribution) identifica linhas/reservas/reversão atual.

Eventos manuais: stock_consumption_attributed e stock_consumption_attribution_reversed. RPCs attribute_finance_stock_consumption e reverse_finance_stock_consumption_attribution seguem contrato aprovado no documento FINANCE-STOCK-CONSUMPTION-CONTRACT-2026-09-10.md; discrepancy_confirmed é boolean obrigatório, true quando divergem declaração operacional e atribuição derivada.

Limites: máximo100aquisições selecionadas por consumo; inventário não é saldo contábil certificado. Retorno físico, perda/ajuste e saldo inicial sem aquisição continuam fatos separados, não equivalentes à reversão de atribuição. Não há inferência FIFO/custo médio. Guard mantém fonte ativa íntegra; correção exige reversão e nova revisão. O teste de dinheiro verifica ausência de movimento e custo extra, sem alegar execução completa de fechamento bancário nesta fixture.
