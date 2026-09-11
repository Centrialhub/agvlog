# Contagem e fechamento do caixa físico: interface

Entrada em Movimentações → Saldos e abertura por conta. Conta física validada pelo diretório usa CashPeriodClosePanel; contas bancárias mantêm o painel bancário. Não há atalho que trate contagem como extrato.

O operador registra denominações/quantidades, responsável pela guarda e motivo, com revisão explícita do saldo ao final do dia selecionado. Total calculado pelo servidor deve corresponder à contagem enviada. Zero é permitido. A contagem final não é abertura nem pagamento. Uma declaração divergente continua registrada.

Seleção explícita da contagem ativa antecede o preview. Tela apresenta abertura, entradas, saídas, saldo esperado, contado e falta/sobra. Campos ausentes permanecem indeterminados. Fechamento requer elegibilidade e capacidade do servidor; nenhuma aceitação de diferença ou movimento de ajuste é criado. Mudança ou falha de consulta impede usar preview obsoleto.

Histórico de contagens mantém autoria, motivo, guarda, denominações e reversões. Correção usa capacidade do servidor por linha. Fechamentos/reabertura reutilizam os comandos/histórico existentes, inclusive impedimento de reabrir predecessor com sucessor ativo. Reabertura permanece disponível pelo histórico quando a consulta atual do caixa falha.

Pedido persistido por empresa/ator/conta antes de enviar. Uma resposta incerta mantém o pedido integral, inclusive o período original após trocar datas na tela. Corrupção local bloqueia novas decisões. Rejeição definitiva na primeira tentativa libera nova revisão e preserva dados de contagem; pedido previamente incerto não é descartado.

Arquivos próprios: cashPeriodContract.ts, cashPeriodClient.ts, CashPeriodClosePanel.tsx, CashPeriodCountForm.tsx, CashPeriodCountsHistory.tsx, CashPeriodPreviewDetails.tsx; integração AccountOpeningEntry.tsx. Testes cashPeriodCloseReview.test.tsx, cashPeriodClient.test.ts e extensão accountOpeningEntry.test.tsx. Nenhum SQL ou AccountPeriodEvidence* foi editado nesta frente.

Verificação: testes de interface/cliente e reader SQL real em andamento; resultados finais abaixo. Nenhuma implantação remota.

Resultado final:14 testes UI/cliente/entrada aprovados, mais4 testes SQL reais do reader com schemas de produção. Lint dos arquivos da entrega aprovado. TSC integrado25522 terminou0 sem diagnósticos; log finance-cash-period-close-ui-tsc.log vazio. Nenhum TSC próprio ativo. Histórico/evidências de caixa foram implementados separadamente pelo coordenador.
