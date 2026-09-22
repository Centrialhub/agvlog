# Centro de custo no lançamento manual

O formulário **Conciliação bancária → Registrar movimentação** agora permite selecionar um centro de custo, com pesquisa e paginação dos centros ativos da empresa. O campo é opcional e também aparece nos demais pontos que usam o mesmo formulário.

A escolha permanece no rascunho ao fechar e reabrir. Após envio sem confirmação, o centro fica congelado junto com os demais dados e a retomada usa o pedido original. Rascunhos anteriores sem esse campo continuam compatíveis.

O banco grava o identificador e o nome do centro de custo na movimentação, na auditoria e na confirmação. O nome é uma fotografia do cadastro no momento do lançamento: renomear ou desativar o centro não altera o histórico. A lista de movimentações mostra o centro abaixo da conta bancária. Essa classificação não cria outra despesa nem duplica valores nos relatórios.

## Banco

Migration aplicada: `20260922214653_finance_movement_cost_center.sql`, projeto `qcvnsdrbcchaxvawcngk`.

- Colunas opcionais `cost_center_id` e `cost_center_name` em `finance_movements`.
- Chave estrangeira composta por empresa e centro, com exclusão restrita e índice de apoio.
- A função existente `record_finance_movement(jsonb)` aceita o campo adicional; a implementação privada valida centro ativo da mesma empresa antes da inserção. A validação ocorre depois da consulta do pedido original, permitindo confirmar novamente um lançamento já gravado mesmo após desativação do centro.
- Mantidas as regras de acesso, RLS, auditoria e idempotência. Execução anônima continua bloqueada.
- Não houve alteração de lançamentos anteriores nem criação de movimentações reais para testar.

## Verificação

- 43 testes passaram em 9 arquivos, abrangendo seleção, persistência do rascunho, recuperação, contratos da resposta, centros inválidos, isolamento por empresa, histórico e regressões da baixa de contas a pagar.
- Testes de PostgreSQL via PGlite verificaram gravação e auditoria com dados sintéticos; os testes da baixa por conta também executaram a nova migration sobre o fixture com 47 triggers do projeto. Os fixtures não reproduzem todas as constraints nem concorrência real do ambiente remoto.
- ESLint dos arquivos alterados, build, verificação de bundle, artefato público e contrato de release Supabase passaram.
- Consultas remotas somente de leitura verificaram o catálogo de centros, a listagem de movimentações, colunas, chave estrangeira, permissões e RLS. Advisor de segurança sem novos avisos.
- A verificação geral de TypeScript mantém os nove erros anteriores em outras partes do projeto; nenhum erro nos arquivos desta alteração.

**A interface ainda não foi publicada no site.** Não houve validação visual autenticada no navegador de produção.

Referência de implementação: [funções de banco no Supabase](https://supabase.com/docs/guides/database/functions).
