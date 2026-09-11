# Guia de uso do financeiro

Referência das telas publicadas em 11/09/2026. Este guia não substitui o aceite completo: a validação autenticada de ponta a ponta continua pendente.

## Acesso e organização

Selecione a empresa correta antes de trabalhar. A barra lateral reúne as páginas no grupo **Financeiro**. O acesso depende da permissão financeira da empresa; motoristas, inclusive usuários com perfil misto de motorista, não podem acessar o módulo. A seleção de empresa não concede permissão por si só.

| Página | Uso principal | Rota |
| --- | --- | --- |
| Painel financeiro | Visão de carteira, custos e pendências | `/financial` |
| Movimentações | Registrar entradas, saídas e transferências que aconteceram fora do sistema | `/financial/movements` |
| Gastos conferidos | Lançar vários gastos e consultar categorias, comprovantes e envios utilizados | `/financial/recorded-expenses` |
| Contas a pagar | Organizar obrigações e associar pagamentos registrados | `/payables` |
| Contas a receber | Organizar cobranças de fornecedores, clientes e outras origens | `/receivables` |
| Folha de pagamento | Gerar e conferir períodos, funcionários e adiantamentos | `/payroll` |
| Extratos importados | Importar arquivo e conferir linhas e pendências | `/financial/statements` |
| Conciliação bancária | Comparar movimentos registrados com linhas do banco | `/bank-reconciliation` |
| Acerto de motoristas | Conferir a composição financeira das viagens | `/driver-settlements` |
| Recebíveis fiscais | Examinar processamento e pendências de origem fiscal | `/financial/fiscal-queue` |
| Auditoria financeira | Consultar autoria, motivos e alterações | `/financial/audit` |

O sistema registra fatos e obrigações. Nenhum botão executa PIX, pagamento ou transferência no banco.

## Um envio para vários gastos de viagem

1. Quando o dinheiro sair, use **Movimentações → Registrar movimentação** e informe o valor total, data, conta e favorecido. Um PIX de R$ 500 é uma única saída registrada.
2. No retorno do motorista, use **Gastos conferidos → Conferir gastos em lote**. Registre combustível, alimentação, descarga e demais itens separadamente, com seus valores e evidências, e associe o envio existente.
3. Confira os totais. As categorias alimentam a análise de custos; a associação com o envio não representa outro PIX. Diferenças precisam ficar explicadas, sem alterar os gastos para forçar uma igualdade.
4. Importe o extrato da conta e confira a conciliação. O vínculo entre gastos e envio não substitui a confirmação bancária da saída.

Compras para a sede e demais despesas fora de viagem também devem ter categoria, favorecido, data e evidência. Uma obrigação ainda não paga não deve ser registrada como dinheiro que já saiu.

## Descarga e fornecedor devedor

Cada entrega admite uma descarga. As notas da entrega determinam o fornecedor responsável pelo reembolso. O favorecido do gasto pode ser o motorista ou prestador; ele não é automaticamente o fornecedor que deve reembolsar a empresa.

Em **Contas a receber**, filtre pela origem descarga. O formulário identifica o fornecedor e o valor **originais**. Use a conferência da cobrança para consultar o valor vigente e o histórico de alterações. Alterar somente o direito de cobrança não altera automaticamente o custo, a obrigação de pagar ou o dinheiro.

Administradores podem abrir **Conferir cancelamento da descarga**. A prévia separa os três efeitos e apresenta impedimentos. Quando permitido e confirmado, o cancelamento conjunto preserva os originais e registra autor e motivo. Valores pagos, recebidos, materializados em composições ou protegidos por fechamento podem impedir a operação; esse bloqueio não significa que o banco devolveu o dinheiro.

## Recebimentos, extratos e divergências

Uma cobrança representa um direito de receber. Sua baixa deve estar ligada ao recebimento registrado, preservando a identidade do dinheiro para evitar contagem dupla. Expectativa de frete, título fiscal, custo e movimentação não são grandezas intercambiáveis.

Importe o extrato em **Extratos importados → Importar extrato**. Confira a conta, o período, as linhas e as pendências indicadas. A conciliação automática exige evidências suficientes; ambiguidades permanecem para conferência. Uma conciliação manual conserva identificação e autoria para auditoria.

O extrato determina o que aconteceu na conta bancária. Diferença de caixa exige revisar cobertura do extrato, saldo inicial, movimentos sem correspondência e correções; não criar uma despesa ou receita fictícia apenas para zerar a diferença. Transferências e saques exigem rastrear a origem e o destino.

## Comprovantes e respostas incertas

No modal **Conferir gastos em lote**, selecione a foto JPEG ou PNG em cada linha. O sistema prepara uma cópia validada antes de registrar o lote; a descarga exige esse comprovante ou um comprovante legado válido. Se a validação falhar, a tela mantém a pendência e informa que o arquivo não foi anexado. Trocar a viagem, entrega ou contexto exige preparar novamente o comprovante correspondente. Esse fluxo está disponível também para sede, pessoal, manutenção e outros gastos.

O detalhe do gasto permite consultar e anexar evidências. Um comprovante anexado depois é identificado como posterior; ele não apaga a informação original de ausência. A validação de formato de arquivo não certifica a autenticidade do comprovante.

Se a tela preservar um pedido sem confirmação, use a recuperação apresentada. Não refaça o mesmo lançamento com outro pedido para contornar uma resposta perdida. A confirmação do comando e a atualização da consulta são etapas distintas: uma falha ao atualizar a lista pode ocorrer depois de o registro ter sido confirmado.

## Origem fiscal

A fila de recebíveis fiscais expõe pendências e inconsistências. Autorização, cancelamento e rejeição precisam ser tratados pela origem fiscal; um diagnóstico de XML não autoriza cobrança por si só. O preview de evidência não emite documento fiscal nem promove automaticamente uma evidência não verificada a conta a receber.
