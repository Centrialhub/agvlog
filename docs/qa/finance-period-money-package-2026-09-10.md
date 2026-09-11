# Consolidação monetária do período — implementação local

## Escopo e contrato

A migration `20260910193723_finance_period_money_package.sql` implementa `get_finance_period_money_package(_tenant_id uuid, _from date, _to date, _account_ids uuid[] default '{}')`. É uma consulta autenticada, com isolamento de empresa e exclusão de motoristas, inclusive perfis mistos. Não escreve dinheiro, obrigações ou fechamentos.

O resultado versão 1 tem `basis: frozen_money`, `status_basis: current_closure_state`, moeda BRL e fuso America/Sao_Paulo. `account_scope.available` inclui contas inativas. A seleção vazia permite montar o seletor, mas retorna totais desconhecidos. Contas selecionadas e excluídas são explícitas; uma seleção parcial pode ter valores comprovados sem representar toda a empresa.

`accounts` contém cobertura, saldos, IDs distintos de movimentos e histórico de fechamentos/reaberturas. Fechamentos bancários apontam para cobertura de extrato; caixas apontam para contagem física. `totals` contém abertura, entradas, saídas e fechamento em centavos inteiros string, ou null quando desconhecidos. `monetary_totals_valid` e `transfer_classification_valid` são independentes: uma classificação de transferência incompleta não apaga saldos brutos comprovados; os três totais ajustados ficam null.

A revisão determinística exclui `captured_at`. Não apresenta carteiras atuais como posição histórica. Metadados das contas e estado de reabertura são atuais, como declarado no envelope. Os valores monetários vêm dos snapshots congelados.

## Regras verificadas

- Cobertura exige intervalo exato por conta, sem recortar arbitrariamente um fechamento maior. Fatias consecutivas exigem cadeia, abertura e saldos compatíveis. Soma a primeira abertura, os fluxos de todas as fatias e o último fechamento.
- Extrato e razão não são somados entre si. Banco e caixa são somados apenas como contas distintas com respectivas provas válidas.
- Transferências são identificadas por IDs congelados e deduplicadas entre contas. A eliminação exige ambas as pernas no conjunto selecionado e no corte, valores/direções/datas/contas compatíveis e ausência de invalidação. Compara também os campos monetários da perna selecionada com a linha congelada.
- Transferência entre cortes, fronteira de contas selecionadas e saída ainda em trânsito permanecem explícitas. Uma chegada posterior não reescreve o pacote anterior.
- JSON inválido de transferências, natureza desconhecida e identidades insuficientes produzem diagnóstico sem derrubar os valores brutos comprovados. Fatos monetários inválidos ou duplicados invalidam o saldo; IDs públicos são normalizados e distintos para manter o diagnóstico legível.
- Histórico de reabertura permanece visível. Um fechamento reaberto deixa de fornecer totais válidos.

## Evidência local

Comando executado: `npx vitest run src/test/financePeriodMoneyPackage.test.ts src/test/periodMoneyBankPackage.test.ts` — **14 testes passaram** (11 da implementação e 3 de integração independentes do root). ESLint passou no helper e no teste próprios. Root também confirmou **27 testes integrados** de SQL, contrato, cliente e painel; não foi uma execução nativa desta subtarefa.

Os testes executam comandos reais de abertura, registro de movimento, contagem, revisão de corte, fechamento, reabertura, transferência e chegada. Incluem seleção vazia/inativa, revisão estável, dois meses consecutivos, transferência eliminada uma vez, seleção parcial, chegada posterior, autorização e isolamento. A integração independente inclui extrato/recebimento conciliado, banco fechado, banco mais caixa e reabertura real. As respostas são analisadas pelo schema TypeScript usado pelo cliente.

Casos de snapshots danificados são injeção de falha exclusiva da fixture: desabilitam temporariamente os triggers de usuário da tabela de fechamento, inserem o defeito e restauram a proteção. Não alegam que produção permite modificar snapshots. Cobrem JSON null/objeto em transferências, natureza desconhecida, identidade/data/direção inválidas e movimento duplicado.

Factory: `src/test/helpers/periodMoneyPackageDatabase.ts`, derivada da cadeia real de fechamento de caixa e instalando as funções reais de transferência. Não usa substituto de escritor que retorne sucesso. Ainda é uma composição de fixtures, e não uma aplicação comprovada de todo o schema de produção.

SHA-256 congelados para validação independente:

- Migration: `685ce9177c4e3b5202d7ac9e6eb13cd4f5963db001a14c16204b23290b624adf`.
- Factory: `a5779e367eb42bc655be5d589300939f680f2e62b9829128a145fc165e64773e`.

## Limites e sequência

Não houve aplicação remota, execução nativa nem typecheck por esta subtarefa. A validação nativa foi encaminhada ao agente responsável pelo runtime após congelamento do hash acima.

Este é o componente monetário do pacote financeiro. Não constitui DRE, posição histórica de carteiras, relatório completo de custos/adiantamentos ou conclusão da adoção de fontes legadas. Contas sem cobertura suficiente permanecem explicitamente desconhecidas. As frentes restantes do documento `finance-period-package-contract-2026-09-10.md` continuam independentes.
