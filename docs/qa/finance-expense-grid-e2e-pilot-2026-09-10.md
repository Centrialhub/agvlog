# Piloto E2E da grade de gastos — preparação, 2026-09-10

Arquivo `e2e/finance-expense-grid-pilot.spec.ts`, independente de finance-readiness do coordenador. Lint saída0. **Não executado em navegador** nesta tarefa: não havia stack Supabase local completa e sessão E2E preparada. Nenhuma afirmação de sucesso ponta a ponta.

## Caso pronto para quality.yml

Usa loginThroughUi/accounts.operator, Playwright desktop-chromium e backend real. Abre Gastos conferidos, consulta get_finance_expense_options sem interceptação, fecha seletor com Escape e preenche categorias/valores pela grade real. Ctrl+Enter adiciona linha com foco; reutilizar dados mantém descrição e deixa valor vazio. Confere300+150+30=480, vinculado0 e complemento480 (nenhum envio foi selecionado). Remove linha do meio e verifica foco/valor do ID remanescente; fecha/reabre rascunho e verifica persistência. Não clica registrar; observa ausência de comandos de lote/movimento.

Seletores derivam de labels/roles atuais ExpenseBatchDialog, ExpenseBatchLine e FinanceOptionPicker. Não há mock de backend, pedido sucesso fabricado nem seletor por posição DOM.

## Por que o piloto ainda não grava saída500 / gastos480 / extrato

O seed atual fornece operador/motorista e viagens em status planned (`supabase/seed.sql:243`), não uma viagem finalizada isolada com encerramento íntegro. Não fornece nesse arquivo conta bancária piloto, saída canônica500, declaração/comprovantes e extratoOFX coerente com identidade da conta. Transformar viagem em completed ou inserir links isolados por SQL no teste mascararia dependências reais.

Para ampliar o navegador sem mascarar regras: fixture exclusiva tenant/conta/motorista/viagem encerrada legitimamente; conta com identidade bancária; OFX com FITID, período, saldo e saída500; comprovantes por categoria; gasto descarga com entrega/NFs do fornecedor; categorias total480; diferença20 identificada como saldo de envio sem composição. Depois executar comandos UI reais, importarOFX e conciliar. A prova SQL do coordenador/core é separada deste caso de navegador.

quality.yml já inicia Supabase, aplica migrations/seed, gera senha do operador e instala Chromium. O novo spec é descoberto pela configuração e2e existente. Se uma RPC faltar, o teste deve falhar; não usar skip por dados ausentes para esconder indisponibilidade do módulo. O único skip é para projetos tablet/mobile porque o cenário específico usa teclado desktop.
