# Rastreabilidade da entrada por origem

`movementReceiptTraceSchema` agora usa `movementReceiptTraceRowSchema`, discriminado por `origin`. Canônico exige `command_id` UUID igual a `link_id` e não aceita associação legada. Legado exige `command_id:null`, ação `receive`, associação com declaração explícita e `correction:null`. A reversão da associação usa campo próprio `association_reversal`; `reversal_id` permanece reservado à devolução real.

`MovementReceiptTrace` usa origem e ID do vínculo como chave e apresenta autoria/motivo da associação e da reversão em bloco manual permanente. Uma associação desfeita não é apresentada como retirada da baixa do título. Devolução real e crédito fiscal permanecem informações separadas. A interface oculta dados anteriores durante atualização e falha.

Seis testes de UI/contrato passaram, cobrindo as duas origens, combinações inválidas, declaração ausente/falsa, paginação e histórico obsoleto. Lint passou. Nenhuma fixture de banco histórico foi relaxada nem migration alterada. A consulta SQL que preenche os novos campos está sob responsabilidade do coordenador.
