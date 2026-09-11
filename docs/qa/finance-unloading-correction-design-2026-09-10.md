# Correções de descarga: contrato de implementação

Estado: desenho em revisão, não é comando disponível. Complementa o plano financeiro e as proteções205941/210433; não reduz o escopo da correção auditada.

## Dois problemas diferentes

1. **Reparar o título divergente.** A descarga e sua evidência estão corretas, mas uma edição antiga alterou o fornecedor ou valor do recebível. Restaurar a projeção a partir da descarga preservada, sem alterar a entrega, suas notas, o custo, o comprovante ou o evento original.
2. **Corrigir a própria descarga.** O fornecedor determinado, valor ou ocorrência originalmente registrados estão errados. Requer uma versão de correção vinculada à mesma descarga e entrega, com reflexos coerentes na cobrança e nos custos. Não se resolve restaurando o título ao dado antigo, nem criando outra descarga.

Nos dois casos: motivo obrigatório, autoria capturada, antes/depois, referência ao pedido, revisão conferida sob trava e repetição idempotente. O sistema registra fatos; nenhum comando executa PIX ou devolução bancária.

## Reparação da projeção

O destino é determinado pelo servidor: fornecedor e valor da origem imutável, jamais valores livres recebidos do navegador. A consulta deve mostrar o título atual e a origem preservada lado a lado, incluindo IDs de fornecedor, entrega e descarga. Homônimos não são correspondência.

Antes de liberar confirmação, verificar a origem e o pedido original, a identidade do recebível, todos os pagamentos e suas regularizações, créditos e vínculos fiscais/de fechamento. Conferência somente dos500 pagamentos da interface é insuficiente. Saldo líquido zero isolado não prova que a regularização esteja completa.

Recebimentos anteriores preservam seu comando, pagador capturado, movimento, comprovante e histórico. Uma devolução comprovada ou correção de alocação pode regularizar o pagamento, mas não apaga essa história. Créditos pendentes e vínculos externos incompatíveis devem aparecer como bloqueios específicos, com IDs que permitam conferência.

O guard financeiro antigo ainda congela identidade depois de qualquer pagamento. A exceção da reparação precisa ser autorizada por um registro privado ligado ao comando, transação, ator, título, revisão e valores exatos; não por flag de sessão controlável pelo cliente ou exceção genérica de administrador. Escrita direta continua rejeitada. A autorização não pode ser reutilizada em outro título ou sobreviver à transação.

Gravar a reparação e sua projeção atomicamente. Falha de histórico, atualização ou validação final deve desfazer tudo. Não modificar valores de movimentos/extrato, não criar pagamento e não apagar cobranças ou comandos originais. Revalidar acesso após espera, inclusive antes de retornar repetição de pedido já confirmado.

## Alteração real ou cancelamento da origem

Preservar `finance_unloading_charges.id` e a unicidade da entrega original. Registrar versões anexas com origem anterior, novo fato, evidência, data econômica declarada e data do registro. O evento original permanece disponível; cancelamento não remove a descarga para permitir nova cobrança inadvertida.

Uma camada de origem vigente deve ser consumida pelos comandos e consultas antes da liberação de alterações: título, elegibilidade de baixa, custos, conferência da viagem, acertos, demonstrativo por fornecedor, auditoria e consultas de dependências. Leitores históricos continuam distinguindo fato original e correção; não passam a apresentar uma versão atual como se fosse o passado.

Mudança de fornecedor exige evidência operacional válida da entrega e todas as notas, ou resolução auditada da inconsistência segundo regra explicitamente definida. Não escolher o primeiro fornecedor nem aceitar nome digitado como identidade. Mudança de valor distingue custo efetivamente corrigido de redução comercial do reembolso: uma não deve reduzir a outra silenciosamente.

O vínculo `finance_expense_items.unloading_id` e as alocações de dinheiro da viagem precisam ser considerados. Cancelar cobrança não prova devolução do dinheiro entregue ao motorista; corrigir o custo não cria uma segunda saída. Prestação de contas e acertos já confirmados exigem ajustes próprios e rastreáveis. Não liberar um comando que atualize apenas o recebível e deixe esses leitores em desacordo.

Pagamentos feitos ao devedor anterior permanecem identificados como tais. Exigir regularização de alocação/crédito/devolução antes de atribuir capacidade a outro devedor. Fechamentos existentes não são reescritos: demonstrar quais correções são anotações posteriores e quais exigem reabertura autorizada de composições afetadas.

## Provas necessárias

- Reparo de título sem pagamento; reparo após regularização completa; bloqueio com recebimento/crédito pendente; origem incompleta ou conflitante não é presumida correta.
- Repetição com mesmo pedido não duplica eventos; corpo ou ator diferente é rejeitado; revogação durante espera é respeitada.
- Corridas entre baixa, correção de alocação, devolução, alteração operacional e correção da descarga, com rollback sem resíduos.
- Mesma entrega com várias notas continua tendo uma descarga; alteração/cancelamento não cria nova identidade nem dupla cobrança.
- Movimento compartilhado com outras despesas/títulos mantém capacidade global e dinheiro contado uma única vez.
- Custo, cobrança, recuperação e caixa permanecem medidas distintas após correção, incluindo viagem/acerto encerrados.
- Histórico e indicação de intervenção manual permanecem visíveis com autor, motivo e data; motorista e papel misto não acessam consulta nem comando.

## Ordem de entrega

Implementar primeiro consulta e comando de reparação da projeção com as suas condições completas; em paralelo, concluir o inventário de consumidores para a versão da origem. A reparação não satisfaz o requisito restante de alterar/cancelar a própria descarga. A liberação desse segundo comando depende da atualização e teste dos consumidores afetados, não apenas de uma nova tabela de versões.
