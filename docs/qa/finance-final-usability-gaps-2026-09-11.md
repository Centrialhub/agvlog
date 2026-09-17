# Lacunas concretas para uso financeiro

Revisão delimitada do briefing financeiro.txt, plano09/09 e código atual. Estado remoto informado pelo coordenador: core e crons ativos,74 revisões/11 processados, sem valores. Não houve escrita remota, emissão fiscal ou teste monetário em produção nesta revisão. Comprovantes/imagens estão em outra frente e foram excluídos.

## P0 — carteira fiscal real ainda incompleta (dados/prova, não falta do worker)

74 registros em revisão exigem saneamento da evidência fiscal. Os85 fatos capturados tinham zero bases autorizadas projetáveis no preflight;11 processados não significam11 recebíveis válidos nem dinheiro recebido. Há ausência de protocolo/chave e valores com precisão inválida nos CTe. A fila existe, expõe motivos e não deve ser contornada com arredondamento ou emissão de documento. Caminhos: src/pages/FinanceFiscalQueue.tsx, src/lib/financial/fiscalQueueContract.ts, supabase/migrations/20260910012756_finance_fiscal_queue_worker.sql. Próxima prova útil: um documento já existente com origem monetária/autorização completas gerar exatamente um título correto ou permanecer em revisão explicável. A aplicação do worker não resolve informação ausente.

## P1 — operação de contas a pagar ainda depende de lista potencialmente truncada (código)

src/hooks/usePayables.tsx:45–60 consulta select(*) sem paginação/range nem total servidor. src/pages/Payables.tsx:62–80 filtra e soma essa resposta no navegador; linha265 anuncia todas as contas. Pagamento parcial também exige saldo real, não soma nominal por status. O painel correto e paginado existe em src/components/financial/PayablePortfolioPanel.tsx, mas seu botão Gerenciar abre a lista antiga e não abre o título selecionado. Em volume superior ao limite da API, localizar/baixar título fora da resposta pode ficar impossível e o indicador aparenta total integral. Prioridade: levar listagem/ações ao mesmo conjunto servidor e revisão do painel, sem criar uma segunda carteira.

## P1 — correção da própria descarga errada não está implementada (código)

A reparação212550 restaura título ao fornecedor/valor da origem existente. Não corrige fornecedor/valor incorretos na própria load_unloading_charges, nem cancela essa origem com histórico econômico. src/pages/Receivables.tsx:254 protege esses campos e oferece somente reparação do título. Fundação de amendments foi interrompida antes de existir, conforme coordenação; não contar proposta de contrato como recurso. Caso real impeditivo: descarga cadastrada para fornecedor errado não pode ser simplesmente editada para continuar cobrança. Preservar bloqueio é correto, mas exige fluxo auditado específico antes de prometer tratamento de toda discrepância. Pagos/fechados tornam o caso mais restrito; não resolver apagando recibos/custo.

## P2 — filtro pedido descarga versus demais recebíveis ausente na carteira de baixa (código)

src/lib/financial/receivablesPageContract.ts:6 admite apenas search/status/client/from/to; src/lib/financial/receivablesPageClient.ts:6 envia esses filtros. src/pages/Receivables.tsx:46 não tem origem/descarga. Há visão de descarga por fornecedor no demonstrativo do período, portanto o relatório não está ausente; falta filtro explícito na fila usada para receber/baixar, sem depender de texto da descrição. O devedor já ocupa client_id, mas rótulo genérico Cliente dificulta distinguir fornecedor reembolsador. Necessidade expressa no briefing: unificar por fornecedor/cliente e filtrar descarga.

## P1 — prova de jornada operacional após implantação (sem prova desta revisão)

Código já cobre lote com múltiplos gastos/um envio, complemento, descarga automática, folha, conciliação manual auditada, caixa físico, banco e fechamento; não relistar esses recursos como ausentes. src/components/financial/ExpenseBatchDialog.tsx tem200linhas, reutilização por teclado, distribuição de envio e rascunho; src/pages/FinanceExpenses.tsx tem histórico paginado. A prova local integrada conhecida500enviado/480gastos/OFX não é a mesma coisa que jornada concluída no app implantado com dados autorizados. Próximo aceite útil:500registrado,300combustível+50lanche+150descarga, título150fornecedor, débito500 conciliado uma vez, KPIs300/50/150, driver/misto sem acesso; depois uma folha com acerto já pago sem nova obrigação. Esta revisão não executou esse aceite e não afirma falha onde só falta evidência.

Escopo: estes pontos não são justificativa para suspender todo módulo. Eles delimitam o que já pode ser usado e quais promessas de completude, volume e correção ainda precisam prova ou código. Plano09/09 contém diagnóstico antigo que já foi implementado; não deve ser apresentado como lista atual de pendências.
