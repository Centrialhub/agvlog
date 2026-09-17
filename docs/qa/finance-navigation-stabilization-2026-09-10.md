# Estabilização da navegação financeira — 2026-09-10

## Correção entregue

`src/app/routeGuards.tsx`: o Layout permanece montado, com FinanceAccessBoundary envolvendo apenas o conteúdo financeiro. Falha na consulta de acesso não remove mais navegação, nem permite montar componentes financeiros. Usuário driver continua redirecionado; perfil interno com negativa do servidor continua bloqueado (inclui perfil misto).

`src/components/financial/FinanceAccessBoundary.tsx`: FinanceUnavailableError identifica endpoint ausente com mensagem de módulo indisponível/atualização necessária. Erro de rede mantém mensagem de confirmação indisponível. Ambos permitem tentar novamente e nenhum autoriza acesso por fallback.

Teste `financialRouteNavigation.test.tsx`: navegação para Viagens após endpoint ausente; erro de rede; cache não confirmado; negativa do servidor para perfil admin/misto; driver redirecionado. Rodada conjunta 7 testes passou, lint dos3arquivos saída0. Layout foi substituído por um shell de navegação no teste para isolar o comportamento do guard; não é ensaio navegador conectado ao ambiente remoto.

## Inventário por leitura

- Menu `components/layout/navigation.ts` e rotas `app/AppRoutes.tsx` correspondem para painel financeiro, movimentações, gastos conferidos, extratos, auditoria, recebíveis fiscais, contas a receber/pagar, acertos e folha. Os atalhos existentes do dashboard para receivables, recorded-expenses, expense-approval, driver-settlements e movements resolvem rotas existentes.
- SidebarNavigation filtra links financeiros com financeAvailable. Ausência de permissão não deve ser confundida com ausência de estrutura; a mensagem específica aparece em acesso direto à rota. Demais seções operacionais permanecem navegáveis.
- AppLayout condiciona painéis de recuperação financeira a financeAvailable; manter Layout não monta esses painéis sem autorização.
- A existência das rotas não comprova disponibilidade das RPCs no ambiente remoto. O bloqueio global por get_finance_access ausente foi identificado e tratado; não foi executado bypass nem migração remota nesta frente.
- Não foi identificado botão novo de origem versionada ativo. UnloadingOriginVersions permanece componente isolado, sem RPC/integração. Compatibilidade dos tipos flowv2 foi estabilizada em PeriodUnloadingFlowDetails/Panel sem publicar endpoint novo.

## Compatibilidade WIP encerrada

Flowv1 preservado; campos opcionais v2 apresentam original/ajuste/líquido sem chamar líquido de saldo devedor. Adjustment mostra autoria/motivo manual e não pede movimento de caixa. Chave inclui a perna do ajuste. 10 testes painel filho/pacote passaram e lint3arquivos saiu0, com regressão focal do ajuste−30 e líquido120. Não executado TSC nesta frente; coordenador é proprietário da checagem final.

## Próxima verificação operacional recomendada

Após disponibilidade do banco confirmada pelo coordenador, executar as rotas com operador autorizado e confirmar carga dos readers fundamentais, lançamento de despesa e recebimento utilizando saídas/entradas registradas. Falha de endpoint não pode ser tratada como lista vazia. Não é necessário criar novas funcionalidades para esse aceite.


## Atualização de 11/09: organização publicada

A folha de pagamento foi movida para o grupo Financeiro. As 16 páginas financeiras têm rotas existentes protegidas, e a resolução da página atual agora escolhe a rota mais específica; abrir /financial/movements ou /financial/statements não destaca o painel nem produz seu breadcrumb incorretamente.

Validação: 12 testes em sidebarNavigation, navigationContract e financialRouteNavigation passaram. TypeScript e build:check passaram. Sites19 publicado com sucesso, revisão 292ebefb713d7e3a2246ef29975ce7c19b1763ec, deployment appgdep_6aa385e913748191933f86488425adac. A audiência existente e a autenticação foram preservadas.

No navegador autenticado, o botão real abriu o formulário de movimentação e o link real navegou para Extratos importados via HTMLElement.click. O comando click da CLI não acionava os controles apesar de retornar sucesso. Durante uma verificação posterior de múltiplas páginas, a sessão retornou à autenticação e o token deixou de estar persistido. Não foi possível concluir a navegação autenticada de todas as páginas nesta rodada; não há evidência para atribuir o encerramento da sessão a uma causa específica. Nenhum lançamento financeiro foi criado pelo teste.
