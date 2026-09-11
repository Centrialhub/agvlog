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
