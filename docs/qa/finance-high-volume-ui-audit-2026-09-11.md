# Auditoria delimitada de UX financeira de alto volume

Revisão somente leitura de código e testes em 2026-09-11. Nenhum acesso a Sites, credencial, produção ou alteração de produto. Não houve execução de testes nesta auditoria; referências abaixo descrevem as provas existentes, não uma nova execução.

## Três lacunas verificáveis

### P2 — Um comprovante em processamento bloqueia a digitação de todo o lote

Fonte: src/components/financial/ExpenseBatchDialog.tsx:27,32,65 e src/components/financial/ExpenseBatchLine.tsx:25.

uploadBusy é verdadeiro enquanto qualquer linha processa arquivo; locked inclui uploadBusy e desabilita o fieldset que contém todas as linhas. Assim, ao anexar a foto do primeiro gasto, o operador não consegue digitar descrição/valor/categoria do segundo gasto, nem selecionar sua foto, até o upload e a validação terminarem. Não há perda de dados demonstrada; a lacuna é o tempo ocioso imposto no lançamento de muitos gastos. O contador protege corretamente o envio contra uploads simultâneos, mas não oferece edição das linhas independentes durante esse trabalho.

Critério de aceite: manter o envio final e alterações de escopo protegidos, bloquear a linha em processamento e permitir preencher uma segunda linha sem sobrescrever a primeira. Teste com promise de upload ainda pendente, digitação real na linha2 e conclusão posterior; IDs/valores e comprovantes devem permanecer. O teste existente expenseBatchPreparedReceipt.test.tsx cobre conclusão fora de ordem/contador e recuperação, mas não elimina esse bloqueio global de interação.

### P2 — O seletor de envios permite escolher disponibilidade antiga durante refetch

Fonte: src/components/financial/FinanceOptionPicker.tsx:17,25,27-30.

O picker usa staleTime0, mas só mostra carregamento com isPending e renderiza opções quando query.data existe e não há erro. Ao reabrir um catálogo já cacheado enquanto a atualização está em andamento, os botões antigos continuam habilitados; o bloqueio existente verifica apenas option.delivery.issue. Um envio cujo saldo foi consumido em outra operação pode ser escolhido com o valor disponível antigo. O servidor ainda revalida o comando; este achado não demonstra dupla utilização de dinheiro. O efeito concreto é propor alocação com informação velha e receber rejeição tardia/retrabalho no lote.

Critério de aceite: durante atualização da mesma consulta, ocultar ou desabilitar opções monetárias antigas e indicar que estão sendo conferidas. Teste com primeira resposta disponível, segundo refetch pendente e posterior saldo menor; onChange não deve aceitar a opção antiga. financeOptionPickerKeyboard.test.tsx já prova foco na busca, retorno ao seletor e Escape, mas não esse cenário de atualização.

### P2 — A folha apresenta zero antes de carregar, e o fechamento permanece acessível

Fonte: src/components/financial/payroll/PayrollPeriodEntries.tsx:35,47-54,103-112,120-121,141; src/hooks/usePayroll.tsx:86-96.

O resultado inicial usa data:entries=[] e calcula os cartões imediatamente. isLoading só substitui o corpo da tabela por Carregando; cartões exibem zero funcionários, bruto/pagos/saldo zerados. Para período já aprovado, Fechar depende apenas de close.isPending, portanto continua acessível antes da leitura das entradas. O backend continua responsável por validar fechamento; não se afirma bypass. A lacuna é apresentar totais aparentemente conhecidos e oferecer ação enquanto a conferência da folha ainda não chegou. O componente também não diferencia um refetch em curso; o hook atualiza a cada30s.

Critério de aceite: mostrar carregamento/valores indeterminados até a primeira resposta e impedir ações que dependem dessa conferência; durante refetch explicitar a atualização, sem apresentar uma confirmação baseada em ausência de dados. Testar período aprovado com leitura pendente e erro posterior, mantendo os totais conhecidos somente após sucesso. financePayrollScreen.test.tsx fixa isLoading:false em todos os casos atuais; já cobre erro,125funcionários, busca além da página visível e troca de período.

## Melhorias existentes que não foram relistadas como lacunas

- Lote: Ctrl+Enter insere após a linha, reutilização gera ID único e deixa valor/comprovante/vínculos vazios; foco estável após remoção; erro abre detalhes e foca data/entrega/valor. expenseBatchEntryUx.test.tsx contém esses casos.
- Um envio com três categorias é distribuído e registrado em um único comando; excesso vinculado fica visível e impede registro. Mesma suíte.
- JPEG/PNG v2 são preparados antes do batch na mesma tela, incluindo descarga; recuperação conserva pedido e prova, sem path ou justificativa falsa. expenseBatchPreparedReceipt.test.tsx cobre o fluxo e os limites de imagem já são informados.
- Recebíveis: busca com debounce, filtros de devedor e origem/descarga e paginação50 no servidor; erro esconde linhas antigas. receivablesPagedScreen.test.tsx contém os quatro cenários. O histórico de pagamentos não depende mais dos500: receivableFinancialFrontendDatabase.test.tsx tem o caso SQL do501º pagamento/devolução.
- Pagáveis: filtros de fornecedor/categoria/situação/origem/data, totais integrais do servidor, páginas30 com revisão, recuperação de mudança e abertura de conta/baixas. payablePortfolioPanel.test.tsx prova paginação, revisão e rótulo corrente já corrigido. Não foi identificado novo bloqueio concreto nesse fluxo nesta revisão.
- Folha: busca/filtros e páginas50 já existem; totais abrangem o período inteiro. Não relistar a antiga falta de paginação.
- Sidebar: as16entradas financeiras estão declaradas em src/components/layout/navigation.ts:68-84; a auditoria não reabriu o problema anterior de navegação removida por falha financeira.

## Limites

Conclusões são inferências diretas dos estados e condições de renderização atuais. Não foram medidos tempo de rede, desempenho com200linhas nem jornada hospedada. Os três itens são melhorias de UX/representação com proteção financeira existente; não autorizam relaxar identidade, revisão, capacidade, recibos ou controles de fechamento.
