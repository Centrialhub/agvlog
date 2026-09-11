# Cliente de confirmação de invalidação

movementVoidCommandContract.ts e movementVoidCommandClient.ts validam o pedido, preservam o payload exato de replay e aceitam apenas resultado confirmado do mesmo tenant/movimento/request/motivo. Respostas de identidade divergente, formato inválido ou falhas de transporte permanecem incertas; somente SQLSTATEs conhecidos de rejeição atômica usam MovementVoidRejectedError.

O resultado exige kind void, nenhuma transação bancária, autoria/data e efeito monetário coerente com retirada de exatamente uma entrada ou saída. A interface deve comparar também autor e efeitos contra a conferência preservada antes de descartar o pedido local.

O contrato de preview aceita can_execute booleano após promoção192831. can_execute=true exige elegibilidade e efeito determinado; elegibilidade exige origem comprovada, ausência de invalidação/bloqueadores e readiness completa. A indicação ready precisa concordar com a lista de proteções ausentes.

Cinco testes do cliente e quatro do contrato de preview passaram, incluindo payload inalterado, erro SQL versus transporte, identidade divergente, centavos inválidos/efeito impossível e prontidão contraditória. ESLint dos arquivos de contrato/cliente/teste passou. O teste público SQL192831 também usa movementVoidResultSchema contra retorno real; oito casos passaram na revisão do coordenador.

A interface de recuperação foi validada separadamente, incluindo proteção de outro pedido entre abas, ator/pedido original/efeitos e tratamento distinto de cache após sucesso. O suplemento PostgreSQL do dispatcher concluiu quatro casos com wrapper autenticado e schemas reais (40947 saída0/servidor parado); root conferiu log/hash. O coordenador também executou26 testes aprovados de cliente, preview, confirmaçãoUI e RPCreal. Não prova homologação completa nem implantação remota.
