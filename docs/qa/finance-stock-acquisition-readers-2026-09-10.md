# Consultas financeiras da aquisição de estoque

Migration `20260910170539_finance_stock_acquisition_readers.sql` entrega contexto e inventário de entradas de estoque. Consultas exigem autorização financeira no servidor. O inventário inclui todas as entradas do filtro, com contagens integrais e páginas de 30; datas não finitas e quantidades/valores inválidos permanecem visíveis como informação a revisar.

O contexto identifica item, quantidade, fornecedor e documento; candidatos são custos canônicos existentes. A elegibilidade e revisão vêm dos helpers do comando de aquisição. Associação ativa e contagem do histórico independem da busca de candidatos. A reversão usa revisão atual e dependências explícitas, sem apagar decisões anteriores.

A mesma migration incorpora associação e reversão ao filtro global de intervenções manuais. Invalidação compartilhada de consultas inclui contexto e inventário financeiro de estoque. Índice parcial por tenant/data/ID atende a listagem de entradas.

Quatro testes SQL/PGlite passaram com schemas reais da interface: 31 candidatos, 1.005 entradas, busca literal por identificadores/documentos, fontes inválidas visíveis, associação/reversão por comandos reais, auditoria manual e exclusão de motorista/outra empresa. A fixture usa fontes baseline e comandos reais; tabelas auxiliares mínimas de extrato servem apenas ao join de apresentação da auditoria, sem afirmar validação bancária.

Rodada integrada do coordenador: 21 testes aprovados em cinco arquivos (comando 8, consulta 4, cliente 3, revisão UI 5, inventário UI 1). ESLint dos arquivos próprios aprovado. Nativo em andamento na data desta anotação. Não houve aplicação remota.

Esta entrega associa uma compra a custo já existente. Não cria despesa, pagamento ou custo contábil novo, não certifica saldo físico e não implementa ainda atribuição de consumo a múltiplas aquisições. Essa etapa permanece dentro do escopo pendente do módulo.

Atualização: ensaio PostgreSQL17.11 concluiu nove casos, sessão42660 saída0 e servidor parado. Core170454 e reader170539 permaneceram nos hashes registrados em `finance-stock-acquisition-native-2026-09-10.md`. Foram incluídas disputas da reserva com mão de obra/peça direta, alterações de fontes, revogação, dependências e preservação de pagamentos/alocações preenchidos. O coordenador conferiu log final e hashes locais. Esses resultados não equivalem a ensaio do esquema remoto completo.
