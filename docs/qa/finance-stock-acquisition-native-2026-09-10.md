# Aquisição de estoque vinculada a custo canônico — PostgreSQL nativo

**9 cenários passaram em PostgreSQL17.11**, 2026-09-10. Handle42660 exit0, servidor descartável parado. Script `scripts/test-finance-stock-acquisition-native-cases.mjs`, selector `finance-stock-acquisition`. Log `node_modules/.cache/qa-postgres/finance-stock-acquisition-native-2026-09-10.log`.

A fixture instala tabelas baseline de estoque/manutenção/folha e funções financeiras reais usadas pelas associações. Inclui60441,60950,61129,61702,61828,70454,70539, auditoria233625 e comandos reais para registrar custos, movimentos e pagamentos. As tabelas mínimas de import/rows existem somente para lookup da auditoria; este ensaio não comprova extrato bancário.

Cenários executados: replay concorrente; duas aquisições disputando um custo; disputa com mão de obra e peça direta nas duas ordens; origem/fornecedor alterado durante espera; revogação de acesso; guard de OLD tenant e unidade de catálogo; dependência concorrente com reversão e capacidade; dinheiro/alocações/pagamentos preenchidos preservados; leitores com schemas reais e isolamento de motoristas/tenant.

Hashes capturados: core70454 `8e56e0d16b593974ab2299713253c1282423793c21442c0f671c3bc6bdce9c7e`; reader70539 `1f7f17c1f2b419c949824e5731c332e31935bfbfc9fd26481cc216fd0b2cfb2e`.

Limites: origem de compra é seed em stock_movements real; não se executa interface ou comando operacional de aquisição. A compra continua uma relação explícita com custo previamente registrado, sem gerar dinheiro nem outro título. A dependência testada é registro explícito finance_stock_acquisition_dependencies, não inferência de lote de compra para consumo histórico. ready=true nesse registro não prova que todo consumo histórico foi mapeado. Fixture não reproduz todo grafo FK nem plataforma Supabase; não há operação remota.

A leitura independente apontou que fornecedor precisava permanecer estável entre comparação da revisão e captura final. O autor adicionou locks de clients e títulos antes de liberar o hash acima. O ensaio confirmou alteração de fornecedor enquanto o comando espera: revisão obsoleta rejeitada, sem associação residual.

Na disputa com mão de obra/peça direta, ambas ordens preservaram um único claim pelo custo. Reserva de dependência durante espera invalidou a revisão da reversão; tentativa com revisão nova foi bloqueada por dependentes. Reserva excedente foi rejeitada sem incrementar consumo. Associação e reversão preservaram JSON integral de títulos, pagamentos, links de pagamento, movimentos e alocações em casos realmente preenchidos, além da quantidade original da compra.

O parser real stockAcquisitionContextSchema/InventorySchema e schemas de confirmação/reversão validaram respostas. Autoria/histórico fazem parte do contexto. Não foi necessário alterar SQL de produto durante o ensaio.
