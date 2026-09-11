# Contrato e cliente do dinheiro por período

periodMoneyPackageContract.ts valida empresa, período, catálogo, seleção e exclusões. Totais conhecidos obedecem à equação abertura + entradas − saídas = saldo final e à soma das contas selecionadas. Conta coberta precisa de fechamento ativo íntegro. Nenhuma seleção ou cobertura incompleta mantém os totais nulos. Uma seleção parcial não é identificada como todas as contas da empresa.

Ajustes de transferências são uma verificação separada: ambas as pernas precisam estar identificadas no escopo e período para eliminar o par interno. O total eliminado corresponde às linhas classificadas e conserva os fluxos brutos. Classificação incerta mantém ajustados nulos, sem apagar um total bruto comprovado. Identidades monetárias repetidas não podem sustentar total válido; um pacote explicitamente inválido continua legível para expor a divergência.

periodMoneyPackageClient.ts consulta somente o RPC get_finance_period_money_package e rejeita resposta de outra empresa, intervalo ou seleção. invalidateAccountReview.ts passou a invalidar também finance-period-money-package para atualização após movimentos, fechamentos, reaberturas e demais ações financeiras existentes.

Nove testes de contrato/cliente passaram (7+2), incluindo seleção vazia e empresa sem contas, contagem dupla, soma inconsistente, eliminação sem origem, nulidade versus zero e escopo parcial. ESLint dos arquivos alterados passou. Fixtures do contrato não comprovam SQL e estão separadas das provas abaixo.

## Integração real do banco e caixa

periodMoneyBankPackage.test.ts passou três casos usando a factory193723 e operações financeiras reais:

- Extrato + recebimento1000 + conciliação + abertura/cobertura/corte + fechamento bancário: pacote retorna entrada1000 uma vez, não2000. Conta não selecionada aparece nas exclusões. Incluir conta sem fechamento torna apenas o total consolidado indeterminado e preserva o saldo comprovado da conta bancária.
- Recortar parte de snapshot mensal não cria uma posição artificial. Reabrir pelo RPC preserva fechamento/reabertura e altera revisão, deixando saldo consolidado indeterminado.
- Fechamentos reais bancário e de caixa físico no mesmo mês consolidam abertura15000, entrada1000 e saldo16000. O caixa usa contagem e não aprovação de extrato bancário.

Esses testes usam schema real da resposta. Persistem os limites das factories focadas: não são homologação da cadeia completa de migrations, autenticaçãoHTTP ou implantaçãoSupabase. A revisão de origem duplicada foi incorporada à SQL: IDs públicos distintos preservam os fatos duplicados para diagnosticar o saldo inválido. A rodada integrada do coordenador passou27 casos em cinco arquivos (11SQLcore,3SQLbank/mixed,7contrato,2cliente,4painel).

TSC62417 concluiu com saída1: dois imports não utilizados em src/pages/Geofences.tsx, sem diagnósticos financeiros. TSC anterior56011 havia passado antes do último ajuste do contrato. Não afirmar compilação integral aprovada sobre este estado.

O suplemento PostgreSQL nativo concluiu oito casos aprovados, com servidor encerrado e log conferido pelo coordenador, conforme finance-period-money-package-native-2026-09-10.md. Exercita banco/caixa, sequência mensal, reabertura, transferências e diagnósticos de manifestos inválidos. A factory usa recortes de DDL e arquivos bancários sintéticos; não certifica a cadeia completa de implantação nem autenticidade externa do extrato.
