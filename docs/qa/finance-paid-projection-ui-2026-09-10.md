# Projeções de pagamentos na revisão do corte

Revisão de integração em 10/09/2026. O classificador 72624 introduziu `exact_projection_alias` para adiantamentos e itens `already_paid`. A tela antes mostrava essa classificação como origem sem resolução e descartava os detalhes das parcelas no parser.

O contrato agora preserva parcelas por pagamento, vínculo, movimento, conta, data e valor. A tela identifica que o pagamento já está representado e mostra apenas as parcelas retornadas para aquela conta e período, sem criar outra soma de saída. Projeções declaradas exatas exigem parcelas concretas, positivas, sem pagamento duplicado e com movimentos/conta compatíveis. Evidências incompletas continuam legíveis como pendência; não recebem classificação positiva pelo cliente.

A revisão também encontrou duas falhas no SQL, corrigidas pelo responsável pelo core antes da validação nativa: exceção ampla para inserção de adiantamento não pago com `paid_at`, e evidência de cadeia emitida como objeto onde o leitor exigia uma lista. O hash SQL corrigido é `81a04b56856933edce8341a07743d5b977e7a688b877d6cafebaf4fe680d4394`.

Validação local: 8 testes passaram em `legacyCutProjectionContract`, `legacyCutReviewPanel` e `legacyCutReviewClient`. ESLint passou nos arquivos de contrato, tela e teste da tela. O responsável pelo core também executou o RPC real com o mesmo parser nos casos de origem sem pagamento e pagamento em múltiplas contas; essa evidência está no relatório do core. Testes de componente não substituem homologação no navegador com sessão real. Validação PostgreSQL nativa do core permanece em execução neste registro.
