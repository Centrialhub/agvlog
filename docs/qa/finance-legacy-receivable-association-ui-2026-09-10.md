# Associação de recebimento antigo — interface

`LegacyReceivableAssociation` associa o ID explícito de um recebimento existente ao ID de uma entrada elegível. Integrado somente às linhas `receivables_payments` do inventário; registros de carga, fechamento e devolução não são tratados como se tivessem o mesmo ID. O histórico em `ReceivableFinancialDialog` mantém acesso à associação depois da saída do inventário.

Exige declaração explícita de que o recebimento corresponde integralmente à entrada escolhida, motivo e revisão antes de enviar. A declaração é `existing_receipt_confirmed:true` no comando persistido e não atesta autenticidade ou origem bancária. Trocar a entrada limpa a declaração. O comando leva a revisão da origem; mudanças observadas na origem ou na capacidade disponível bloqueiam a revisão anterior.

Pedidos são preservados antes do envio por empresa/responsável/recebimento. Falha de armazenamento impede envio; armazenamento corrompido bloqueia novos pedidos. Resposta incerta preserva o comando original e sua revisão, mesmo que nova consulta já mostre a associação ou a retomada receba rejeição transacional. Rejeição conhecida na primeira tentativa permite nova revisão após rollback. Consulta em atualização ou falha oculta dados obsoletos.

Reversão desfaz somente a associação, preservando recebimento, título baixado e dinheiro. Histórico paginado mantém identificação manual, autoria, data, motivo, entrada e correções. A conciliação bancária permanece separada. Ausência de candidata orienta revisar dados existentes, sem sugerir outro recebimento.

Validação: 33 testes passaram (UI 9, cliente 4, seleção da fonte no inventário 1, inventário existente 3 e receivableFinancialFrontendDatabase 14 e auditoria 2). Lint dos arquivos da entrega passou. TypeScript integrado fica com o coordenador. Nenhum SQL editado ou aplicado remotamente nesta frente.
