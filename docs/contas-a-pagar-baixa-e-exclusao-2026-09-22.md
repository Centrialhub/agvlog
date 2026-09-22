# Contas a pagar: conta de origem, seleção e exclusão

Correção dos problemas relatados nas capturas de 22/09/2026.

## Comportamento

- **Baixas → Registrar pagamento realizado** permite escolher a conta de origem, informar valor, data, forma de pagamento, referência opcional e observação. A revisão precede a confirmação.
- A saída bancária e sua alocação no título são gravadas na mesma transação. Erro de saldo, conta, autorização ou vínculo desfaz a operação inteira. A baixa parcial atualiza o saldo pelos triggers existentes.
- Pedidos sem resposta conclusiva são preservados no navegador e retomados com o mesmo identificador. O servidor impede duplicação e verifica empresa, autor e conteúdo do pedido.
- Títulos pendentes exibem acesso à aprovação existente. A baixa continua dependendo de aprovação e saldo disponível.
- Os checkboxes selecionam também títulos pendentes e cancelados. Há seleção de todos os títulos da página. A elegibilidade para baixa em lote permanece separada da seleção para exclusão.
- **Excluir selecionados** pede motivo e cancela/arquiva títulos elegíveis. O filtro **Exibição → Excluídos** permite consultar o histórico. Não há remoção física de evidências financeiras.
- Títulos com pagamentos não podem ser excluídos. Títulos abertos com vínculos operacionais devem ser corrigidos na origem. Uma seleção com impedimento é recusada integralmente. Revisões protegem contra alterações concorrentes.
- Títulos arquivados ficam protegidos contra alteração ou reativação, evitando obrigações ativas ocultas da carteira.

## Banco aplicado

Projeto: `qcvnsdrbcchaxvawcngk`.

Migration: `20260922213900_payable_account_payment_and_archive.sql`.

RPCs: `pay_finance_payable_from_account(jsonb)` e `archive_finance_payables(jsonb)`. Ambas têm wrappers `SECURITY INVOKER`, execução concedida a `authenticated`, sem execução anônima; as funções privadas verificam o acesso financeiro ao tenant. A consulta da carteira aceita `visibility` (`active`, `archived`, `all`), mantendo a assinatura pública anterior.

Verificação remota somente de leitura: carteira ativa com 4 títulos, excluídos com 0, todos com 4. A tabela privada tem RLS e não permite inserção direta por usuários autenticados nem leitura anônima. O trigger de proteção está habilitado. Nenhuma baixa ou exclusão real foi executada para testar.

O advisor de segurança manteve os avisos anteriores. Acrescentou apenas o informativo de RLS sem política para a tabela privada de arquivos: acesso direto é negado intencionalmente e os comandos autorizados passam pelas funções privadas. Referência: [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Validação

- 53 testes passaram em 10 arquivos, cobrindo interface, retomada, conta obrigatória, aprovação, seleção, exclusão, contratos e regressões de baixa/histórico.
- Testes de banco executam PostgreSQL local via PGlite com funções e 47 triggers capturados do projeto, usando dados sintéticos. Validam atomicidade, idempotência, saldo, isolamento de conta por empresa, autorização, revisão e proteção do histórico. O fixture não reproduz todas as constraints do projeto.
- ESLint dos arquivos alterados passou.
- Build da interface (`npm run build`) passou.
- Verificador de release Supabase passou (698 migrations, 48 funções).
- Typecheck geral continua com 9 erros preexistentes em `BillingEdi`, `OperationsDashboard` e três arquivos de testes; nenhum erro nos arquivos desta correção.

**A interface foi corrigida no código, mas ainda não foi publicada no site.** Não houve teste visual autenticado no navegador de produção. A publicação também deve considerar os erros gerais de TypeScript e as demais alterações já existentes no workspace.
