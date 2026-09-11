# Dinheiro por período — painel — 2026-09-10

Painel `PeriodMoneyPackagePanel` integrado em `Financial.tsx`, protegido por `FinanceAccessBoundary` e chave de empresa/ator. Usa exclusivamente `readPeriodMoneyPackage`, fornecido pelo coordenador. Nenhum comando de escrita.

- Filtros próprios de início/fim e seleção explícita de contas, inclusive inativas. Seleção vazia carrega catálogo e não mostra zero.
- Catálogo paginado em 30 contas, saldos em 10, fechamentos/reaberturas e transferências em 20. A seleção de todas as contas e os totais mantêm o conjunto completo, independentemente da página.
- Valores brutos separados de fluxos sem pares internos. Ajuste indeterminado não apaga valores brutos válidos. Conta sem cobertura e total inválido permanecem indeterminados.
- Escopo parcial explicitamente distinto do conjunto de contas da empresa. Base preservada nos fechamentos, com situação atual dos fechamentos, sem alegar DRE ou balanço patrimonial.
- Histórico com autor, motivo, data, IDs de fechamento/reabertura e referências de abertura/cobertura/contagem. Transferências mostram origem/destino/movimentos e classificação sem inferência por valores.
- Dados antigos ocultos durante atualização ou erro. Query key `finance-period-money-package` inclui empresa, ator e filtros.

Arquivos: componentes `PeriodMoneyPackagePanel.tsx` e `PeriodMoneyPackageHistory.tsx`, rótulos `periodMoneyIssueLabels.ts`, integração `Financial.tsx`, testes `periodMoneyPackagePanel.test.tsx`.

Validação: quatro testes UI passaram (seleção/vazio/inativa, bruto versus ajuste, stale/erro, nulidade/autoria e paginação completa); ESLint dos cinco arquivos passou. TSC não iniciado, aguardando coordenação com os responsáveis pelo contrato e banco. Sem implantação remota.

Atualização final: o período inicial agora é o último mês calendário encerrado em São Paulo, mantendo os filtros editáveis. O helper `previousClosedMoneyMonth` foi verificado na virada de ano antes/depois de meia-noite de São Paulo e em fevereiro bissexto. Seis testes UI/calendário passaram, ESLint limpo. Incluídas as quatro novas condições do core (natureza inválida, referência de transferência inválida, divergência de versão do movimento e relação de transferências inconsistente). TSC único 56011 terminou com código 0, log `finance-period-money-package-ui-tsc.log`.
