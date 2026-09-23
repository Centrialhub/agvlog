# Auditoria do módulo financeiro — 22/09/2026

## Atualização — correções de 23/09/2026

Foram corrigidas gravação manual, concorrência, paginação financeira de faturas e cobrança, além de melhorias na fila fiscal, alçadas opcionais, recuperação e navegação. Quatro migrations foram aplicadas no banco ativo. A regra atual de aprovação foi preservada. Passaram 141 testes, typecheck, build e verificações de leitura em produção. O frontend ainda não foi publicado, e os 155 documentos fiscais em revisão continuam dependendo de correção comprovada na origem.

[Entregas, validação e pendências desta rodada](F:/agvlog-main/docs/correcoes-auditoria-financeiro-2026-09-23.md). Os achados abaixo preservam o retrato original; consulte essa atualização para seu estado atual.

## Atualização — correção aplicada em 22/09 às 18:08 (Brasília)

As 16 incompatibilidades de RPC identificadas abaixo foram corrigidas no banco ativo pela migration
`20260922210823_finance_production_rpc_compatibility`. A verificação posterior encontrou 171 chamadas
com assinatura identificável compatíveis, zero funções ausentes e zero assinaturas incompatíveis
nesse conjunto. Passaram 23 testes locais e 13 verificações de leitura no banco ativo.

[Relatório da correção e seus limites](F:/agvlog-main/docs/finance-production-compatibility-2026-09-22.md).
As seções seguintes preservam o estado anterior à correção; os demais achados continuam pendentes.

## Reverificação do banco — 22/09/2026 às 17:53 (Brasília)

Uma nova leitura direta do catálogo do projeto `qcvnsdrbcchaxvawcngk`, comparada novamente com o código local, confirmou **as mesmas 16 incompatibilidades: 12 funções ausentes e 4 assinaturas incompatíveis**, em 17 chamadas. Nenhum dos 16 casos anteriores foi resolvido e nenhum caso adicional foi encontrado no mesmo escopo.

As quatro assinaturas existentes continuam sem os parâmetros esperados: `_expected_revision` em `get_finance_payable_movements`, `get_finance_payable_payment_history` e `list_available_loads_for_settlement_v2`; `_request_id` em `reassign_finance_statement_account_v1`. As quatro concedem EXECUTE ao papel authenticated; nesses casos, o problema verificado é de assinatura, não ausência desse grant.

O histórico remoto continua com 881 migrations e maior versão `20260922195558`. A constraint `payables_amount_positive` e os triggers `stamp_payable_material_editor_v1` e `audit_payable_material_edit_v1` continuam ausentes.

A varredura avaliou 178 chamadas de nome literal: 154 têm um candidato de assinatura compatível, 13 pontos chamam funções ausentes, 4 têm parâmetros incompatíveis e 7 exigem resolução manual dos argumentos. Outros 35 pontos usam nomes dinâmicos. Compatibilidade de assinatura não certifica execução, payload de resposta ou regras de negócio.

[Resultado completo da reverificação](F:/agvlog-main/docs/qa/auditoria-financeiro-2026-09-22-reverificacao.json). Nenhuma migration, função ou dado financeiro foi alterado.


O módulo tem uma base robusta de rastreabilidade, mas o estado local ainda não está pronto para uma publicação conjunta com o banco ativo. As prioridades são alinhar os contratos entre interface e banco, concluir a recuperação dos cadastros manuais, resolver a fila fiscal e tornar as tarefas diárias mais claras.

A recomendação é evoluir a base existente em etapas. Já existem conciliação, baixa em lote, créditos, renegociação, previsão de caixa, fechamento e comandos recuperáveis; essas capacidades devem ser preservadas.

## Escopo e limites

- Mapeamento das 17 rotas declaradas em [financeRoutes.ts](F:/agvlog-main/src/lib/financial/financeRoutes.ts:1), incluindo receber, pagar, movimentos, despesas, extratos, auditoria, previsão, fiscal, faturas, DOCCOB, fechamentos, aprovação, conciliação, centros de custo, folha e acertos.
- Inventário automatizado de 457 arquivos de componentes, bibliotecas, páginas e hooks relacionados; leitura dirigida dos fluxos e regras de maior risco. Esse inventário não equivale à revisão manual de cada linha.
- Comparação de 178 chamadas com nomes literais contra o catálogo do banco vinculado ao repositório. Foram identificados ainda 35 pontos de transporte com nome dinâmico; a análise automática não certifica todos os adapters, tipos ou respostas.
- Consultas somente de leitura ao projeto Supabase `qcvnsdrbcchaxvawcngk`: funções, políticas, triggers, constraints, contagens agregadas, fila fiscal, agendamentos e advisors.
- 183 testes passaram em 32 arquivos selecionados. A checagem TypeScript do projeto falhou com 9 diagnósticos, sendo 2 no código da tela de cobrança.
- Não executei lançamentos, correções, pagamentos ou migrations no banco ativo. Não validei visualmente a versão publicada nem executei jornadas autenticadas no navegador. As falhas de compatibilidade abaixo descrevem o código local em relação ao banco consultado; não provam que o frontend publicado já utiliza esse código.
- Base local em `4089f464`, com centenas de alterações preexistentes. As evidências são um retrato desta auditoria. Node local 24.19.0, enquanto o projeto requer Node 22.

[Evidências estruturadas](F:/agvlog-main/docs/qa/auditoria-financeiro-2026-09-22-evidencias.json).

## Recursos que já devem ser preservados

1. Separação entre movimentação declarada, extrato, obrigação, custo e liquidação.
2. Comandos idempotentes, revisão de contexto e recuperação de respostas incertas em vários fluxos críticos.
3. Tratamento explícito de créditos, descontos, perdas, estornos e cancelamentos.
4. Políticas restritivas de empresa ativa e bloqueio de motorista nas tabelas financeiras inspecionadas.
5. Fechamento por conta/período, evidências e trilha de intervenções.
6. Previsões preservadas com comparação posterior ao realizado.
7. CI com typecheck, testes, verificação de migrations e jornadas em ambiente isolado. A melhoria necessária é incluir a compatibilidade com o ambiente que receberá a publicação.

## Achados prioritários

### 1. P1 — Publicação local incompatível com o banco ativo

**Evidência:** 12 funções distintas ausentes e 4 com assinatura incompatível, em 17 pontos de chamada. Uma das ausentes pertence à integração financeira do portal. A maior versão registrada no histórico remoto consultado era `20260922195558`; o catálogo real, e não apenas essa versão, foi usado na comparação.

**Impacto:** publicar a interface local nessa condição pode indisponibilizar listagens, aprovação/fechamento de folha, seleção de movimentos, histórico de pagamentos e revisão de extratos.

**Melhoria:** montar um candidato de publicação com manifesto de frontend, migrations e Edge Functions; verificar funções, argumentos e formatos de resposta no banco de destino; ensaiar a atualização a partir de uma cópia representativa do estado ativo; liberar o frontend após confirmar compatibilidade. Não executar toda a cadeia histórica indiscriminadamente.

**Aceite:** nenhuma incompatibilidade no manifesto das rotas; jornadas de leitura e escrita aprovadas no ambiente de homologação, com a mesma combinação de versões destinada à produção.

| Função | Diagnóstico no banco ativo | Chamada local |
|---|---|---|
| `get_finance_legacy_reconciliation_summary` | Ausente | [src/hooks/useBankReconciliation.tsx](F:/agvlog-main/src/hooks/useBankReconciliation.tsx:211) |
| `get_finance_payable_movements` | Parâmetros incompatíveis | [src/lib/financial/ledgerClient.ts](F:/agvlog-main/src/lib/financial/ledgerClient.ts:133) |
| `list_finance_fiscal_queue_v2` | Ausente | [src/lib/financial/ledgerClient.ts](F:/agvlog-main/src/lib/financial/ledgerClient.ts:127) |
| `close_payroll_period_v2` | Ausente | [src/hooks/usePayroll.tsx](F:/agvlog-main/src/hooks/usePayroll.tsx:193) |
| `list_finance_legacy_reconciliation_rows` | Ausente | [src/hooks/useBankReconciliation.tsx](F:/agvlog-main/src/hooks/useBankReconciliation.tsx:251) |
| `list_available_loads_for_settlement_v2` | Parâmetros incompatíveis | [src/hooks/useDriverSettlements.tsx](F:/agvlog-main/src/hooks/useDriverSettlements.tsx:390) |
| `reassign_finance_statement_account_v1` | Parâmetros incompatíveis | [src/lib/financial/ledgerClient.ts](F:/agvlog-main/src/lib/financial/ledgerClient.ts:242) |
| `list_finance_expense_page_v2` | Ausente | [src/lib/financial/ledgerClient.ts](F:/agvlog-main/src/lib/financial/ledgerClient.ts:190) |
| `list_driver_expenses_for_review_v2` | Ausente | [src/hooks/useExpenseReview.ts](F:/agvlog-main/src/hooks/useExpenseReview.ts:15) |
| `approve_payroll_period_v3` | Ausente | [src/hooks/usePayroll.tsx](F:/agvlog-main/src/hooks/usePayroll.tsx:165) |
| `portal_list_financial_titles_v2` | Ausente | [src/hooks/portal/usePortalFinancialTitles.ts](F:/agvlog-main/src/hooks/portal/usePortalFinancialTitles.ts:26) |
| `get_finance_payable_payment_history` | Parâmetros incompatíveis | [src/lib/financial/ledgerClient.ts](F:/agvlog-main/src/lib/financial/ledgerClient.ts:145) |
| `get_finance_settlement_expense_context_v2` | Ausente | [src/lib/financial/settlementExpenseContextClient.ts](F:/agvlog-main/src/lib/financial/settlementExpenseContextClient.ts:6) |
| `get_finance_receivables_page_v3` | Ausente | [src/lib/financial/receivablesPageClient.ts](F:/agvlog-main/src/lib/financial/receivablesPageClient.ts:6) |
| `list_finance_statements_v2` | Ausente | [src/lib/financial/ledgerClient.ts](F:/agvlog-main/src/lib/financial/ledgerClient.ts:213) |
| `get_finance_payroll_entry_page` | Ausente | [src/lib/financial/ledgerClient.ts](F:/agvlog-main/src/lib/financial/ledgerClient.ts:149) |

Nas quatro assinaturas incompatíveis, o banco não recebe o novo `_expected_revision` nas consultas de movimentos, pagamentos e romaneios; a troca de conta do extrato não recebe `_request_id`.

### 2. P1 — Tela de cobrança utiliza componente não importado

**Evidência:** [BillingEdi.tsx:223](F:/agvlog-main/src/pages/BillingEdi.tsx:223) e [BillingEdi.tsx:311](F:/agvlog-main/src/pages/BillingEdi.tsx:311) usam `DataPagination` sem definição/import. O TypeScript retornou `TS2304`.

**Impacto:** bloqueia o gate de tipos; um bundle que apenas transpile o código pode falhar ao renderizar esses trechos.

**Melhoria:** corrigir o import e verificar a renderização das abas de faturas e histórico. Os testes estáticos de paginação passam e não substituem esse teste de renderização.

**Aceite:** zero erro TypeScript; abrir, filtrar e paginar as duas abas sem exceções.

### 3. P1 — Criação manual de títulos não tem a mesma recuperação dos pagamentos

**Evidência:** [useReceivables.tsx:50](F:/agvlog-main/src/hooks/useReceivables.tsx:50) e [usePayables.tsx:68](F:/agvlog-main/src/hooks/usePayables.tsx:68) fazem `insert` direto, sem identidade durável do pedido. Isso se refere ao cadastro manual simples; o fluxo de XML e outros comandos já têm mecanismos próprios.

**Cenário:** o banco grava, a resposta se perde e o usuário tenta salvar novamente. Um novo ID pode criar outra obrigação. Desabilitar o botão enquanto aguarda não resolve resposta perdida ou reabertura da tela.

**Melhoria:** comando atômico de criação com `request_id`, payload preservado e consulta do resultado original. Acrescentar alerta de possível duplicidade por empresa, contraparte, documento, parcela e valor, permitindo duplicidades legítimas mediante revisão.

**Aceite:** timeout após commit, duplo clique, recarregamento e duas abas resultam em um único título para o mesmo pedido. Nenhum pagamento extra é criado.

### 4. P1 — Edição de recebíveis pode sobrescrever outra edição

**Evidência:** [useReceivables.tsx:69](F:/agvlog-main/src/hooks/useReceivables.tsx:69) atualiza por ID e empresa, sem comparar a revisão aberta. O cadastro de pagar já utiliza comparação de `updated_at` em [usePayables.tsx:93](F:/agvlog-main/src/hooks/usePayables.tsx:93).

**Cenário:** duas pessoas abrem um título manual ainda editável. A segunda salva dados antigos e substitui a alteração da primeira. As proteções do histórico financeiro não equivalem a controle de concorrência de todos os campos editáveis.

**Melhoria:** revisão esperada obrigatória no servidor, retorno claro de conflito e apresentação do que mudou. Registrar autor e antes/depois dos campos materiais.

**Aceite:** duas edições com a mesma revisão não podem confirmar ambas; a segunda preserva o formulário e solicita nova conferência.

### 5. P1 — Faturas perdem cobertura financeira após 500 registros

**Evidência:** a função ativa `list_client_invoice_financials` devolve no máximo 500 faturas, como também consta na [migration original](F:/agvlog-main/supabase/migrations/20260830192908_audit_client_invoice_lifecycle.sql:100). O [hook](F:/agvlog-main/src/hooks/useClientInvoices.tsx:95) busca todas as faturas por outra consulta, cruza apenas as 500 verificadas e marca as restantes como `requires_reconciliation: true`. Também devolve `truncated: false` independentemente da sinalização original. O [contrato](F:/agvlog-main/src/lib/financial/clientInvoiceList.ts:12) mantém o teto de 500.

**Impacto:** a partir da 501ª fatura, registros antigos podem aparecer como inconsistentes simplesmente por falta de cobertura da consulta. Os indicadores podem ficar indisponíveis, e cada abertura da tela transfere a coleção inteira.

**Melhoria:** listagem financeira paginada no servidor, com filtros, saldos e totais derivados de um mesmo snapshot/revisão. Distinguir “não consultado” de “divergência financeira”.

**Aceite:** cenários com 501 e 10.000 faturas preservam saldos e busca em todo o conjunto, sem carregar tudo no navegador nem exigir conciliação fictícia.

### 6. P1 — Fila fiscal exige resolução operacional

**Evidência no banco ativo:**

- 236 observações históricas; 173 delas em revisão.
- Ao considerar apenas a observação mais recente de cada emissão, existem **155 documentos em revisão: 129 CT-e e 26 NFS-e**, com status preservado `authorized` e ambiente `production`.
- Motivos atuais: 112 com ausência de evidência de autorização e valor inválido; 24 somente com ausência de evidência; 13 somente com valor inválido; 4 também com pagador ausente; 2 com conflito de líquido/retenções.
- Há pendências desde 11/09.
- Os dois agendamentos financeiros estavam ativos e cada um registrou 1.440 execuções com status `succeeded` nas 24 horas consultadas. Isso demonstra execução do job, não sucesso de cada documento.
- A [tela fiscal](F:/agvlog-main/src/pages/FinanceFiscalQueue.tsx:24) apresenta status, motivo e prévia, mas não oferece uma fila completa com atribuição, prazo e encaminhamento para correção.

**Impacto:** documentos continuam fora de uma incorporação financeira confiável. O status `authorized` preservado, por si só, não substitui protocolo, valor e pagador válidos; não calculei receita perdida nem autorizei cobrança desses registros.

**Melhoria:** fila de exceções por documento atual, separada do histórico, com responsável, idade, valor quando confiável, motivo traduzido e ação para corrigir a origem. Reprocessar somente após comprovar a alteração. Medir documentos resolvidos e reincidência por causa.

**Aceite:** cada pendência tem destino operacional; resolução confirmada cria/atualiza uma única origem financeira; eventos repetidos ou fora de ordem não duplicam títulos.

### 7. P2 — Permissões não representam todas as responsabilidades financeiras

**Evidência:** `finance_private.can_access` admite owner/admin/operator. A função ativa de aprovação de conta a pagar valida esse acesso, revisão e elegibilidade, mas não distingue preparador de aprovador nem contém alçada por valor. A regra está em [finance_payable_revision_approval.sql](F:/agvlog-main/supabase/migrations/20260911085400_finance_payable_revision_approval.sql:44).

Há também uma inconsistência de interface: [Receivables.tsx:176](F:/agvlog-main/src/pages/Receivables.tsx:176) oferece criar/editar ao operador, enquanto as políticas de INSERT/UPDATE de recebíveis no banco inspecionado exigem administrador.

**Impacto:** a política atual concentra responsabilidades em perfis amplos; alguns usuários descobrem que não podem concluir a tarefa apenas ao salvar.

**Melhoria:** capacidades explícitas para consultar, cadastrar, aprovar, baixar, estornar, reabrir período e exportar. Introduzir alçadas configuráveis e dupla aprovação acima do limite definido pela empresa; alinhar botões às capacidades retornadas pelo servidor. Preservar todas as validações no backend.

**Aceite:** matriz de permissões testada por operação, empresa e papel; usuário sem capacidade não vê uma ação executável; dupla aprovação, quando configurada, exige pessoas diferentes.

### 8. P2 — Recuperação de operações fragmentada por tela e armazenamento

**Evidência:** 27 arquivos `*Outbox.ts` no diretório financeiro; aprovação usa localStorage, importação usa IndexedDB e conciliação/fechamento usam sessionStorage, por exemplo [StatementReconciliation.tsx:13](F:/agvlog-main/src/components/financial/StatementReconciliation.tsx:13) e [AccountPeriodClosePanel.tsx:15](F:/agvlog-main/src/components/financial/AccountPeriodClosePanel.tsx:15).

**Impacto:** a possibilidade de retomar depende do fluxo e da aba. Fechar uma aba pode remover a identidade local de uma operação cujo resultado ficou incerto. O histórico do servidor permanece, mas exige investigação do usuário.

**Melhoria:** central de operações pendentes com identidade, estado, vínculo para o objeto, consulta do resultado no servidor e instrução de recuperação. Compartilhar infraestrutura de persistência/lock, mantendo validação de payload e resultado específica por comando. Nunca reenviar um pedido incerto com novo ID automaticamente.

**Aceite:** resposta perdida seguida de fechamento/reabertura permite identificar o resultado sem novo lançamento; trocar usuário/empresa não revela pedidos alheios.

### 9. P2 — Navegação e filtros exigem esforço excessivo do operador

**Evidência:** [FinanceWorkspace.tsx:11](F:/agvlog-main/src/components/financial/FinanceWorkspace.tsx:11) coloca 17 destinos numa barra horizontal. A visão geral combina fontes com bases temporais distintas, explicitadas em [Financial.tsx:193](F:/agvlog-main/src/pages/Financial.tsx:193). Pagar tem filtros próprios; em receber, os indicadores abrangem a carteira inteira enquanto a tabela aplica o filtro.

**Impacto:** a informação é tecnicamente sinalizada, mas o operador precisa interpretar repetidamente o alcance de cada número e transitar entre muitas áreas.

**Melhoria:** organizar a navegação por tarefas — receber, pagar, banco/caixa, custos e fechamento — mantendo os atalhos existentes. Mostrar claramente “carteira total” e “resultado do filtro”, oferecer bases de data explícitas e conservar filtros em URL nas áreas que ainda usam estado apenas local. Remover IDs e códigos técnicos do conteúdo principal quando houver identificação de negócio.

**Aceite:** de uma pendência na visão geral, chegar ao item e à próxima ação mantendo contexto; filtros aplicados são perceptíveis e reproduzíveis por link.

### 10. P2 — Estrutura dificulta manutenção segura

**Evidência:** 11 arquivos acima de 300 linhas e 135 arquivos do inventário com pelo menos uma linha acima de 1.000 caracteres. Portanto, contar linhas isoladamente mascara complexidade. Há repetição de locks, recuperação, classificação de erros, invalidação de cache e formulários de confirmação.

Componentes como o drawer de acerto e o wizard de faturas concentram composição de tela, estado e regras de interação. Há helpers de dinheiro/data dispersos, inclusive fuso fixo em [FinanceFiscalQueue.tsx:13](F:/agvlog-main/src/pages/FinanceFiscalQueue.tsx:13) e [receivablePortfolioContract.ts:25](F:/agvlog-main/src/lib/financial/receivablePortfolioContract.ts:25). Os hooks antigos `useReceivables()` e `usePayables()` continuam exportados, sem consumidores de produção encontrados na busca; suas consultas sem paginação não devem voltar a ser usadas.

**Melhoria:** formatar sem alterar comportamento; extrair responsabilidades por domínio; padronizar datas/centavos e recuperação; remover exports obsoletos após confirmar referências; reforçar contratos tipados de RPC. Evitar uma refatoração geral simultânea à correção financeira.

**Aceite:** mudanças pequenas com regressão por fluxo; regras monetárias no servidor/contratos; componentes de exibição sem comandos financeiros embutidos.

| Arquivo | Linhas no inventário |
|---|---:|
| [src/components/financial/DriverSettlementDrawer.tsx](F:/agvlog-main/src/components/financial/DriverSettlementDrawer.tsx) | 686 |
| [src/components/financial/NewInvoiceWizard.tsx](F:/agvlog-main/src/components/financial/NewInvoiceWizard.tsx) | 351 |
| [src/components/financial/ReceivableAgreementDialog.tsx](F:/agvlog-main/src/components/financial/ReceivableAgreementDialog.tsx) | 492 |
| [src/pages/Receivables.tsx](F:/agvlog-main/src/pages/Receivables.tsx) | 319 |
| [src/pages/BillingEdi.tsx](F:/agvlog-main/src/pages/BillingEdi.tsx) | 610 |
| [src/pages/ClosingReports.tsx](F:/agvlog-main/src/pages/ClosingReports.tsx) | 340 |
| [src/pages/BankReconciliation.tsx](F:/agvlog-main/src/pages/BankReconciliation.tsx) | 451 |
| [src/hooks/useBankReconciliation.tsx](F:/agvlog-main/src/hooks/useBankReconciliation.tsx) | 320 |
| [src/hooks/useBilling.tsx](F:/agvlog-main/src/hooks/useBilling.tsx) | 403 |
| [src/hooks/useDriverSettlements.tsx](F:/agvlog-main/src/hooks/useDriverSettlements.tsx) | 555 |
| [src/hooks/usePayroll.tsx](F:/agvlog-main/src/hooks/usePayroll.tsx) | 349 |

A contagem inclui a última linha vazia quando presente. Tamanho de arquivo não foi tratado como defeito financeiro por si só.

## Melhorias de produto com maior retorno operacional

As propostas abaixo evoluem capacidades existentes e têm critérios de resultado verificáveis.

| Prioridade | Melhoria | Entrega concreta | Critério de resultado |
|---|---|---|---|
| P1 | Central “O que preciso resolver hoje” | Vencimentos próximos, atrasados, aprovações, fiscal bloqueado, movimentos sem vínculo, extratos pendentes e comandos incertos, com responsável e próximo passo. | Toda pendência abre o registro correto; contagens batem com a fonte e não contam eventos históricos como novos documentos. |
| P1 | Rotina de cobrança | Faixas de atraso, carteira por cliente, responsável, promessa de pagamento, próxima ação e histórico. Aproveitar os acordos/parcelas e créditos existentes. | Promessa altera apenas a previsão; recebimento exige confirmação financeira. Medir atraso e cumprimento de promessas. |
| P2 | Tesouraria diária | Curva diária/semanal de saldo, menor saldo previsto, reserva mínima e simulação de adiamento/antecipação. Aproveitar snapshots, cenários e comparação ao realizado existentes. | Mostrar quando falta caixa mesmo se o saldo final do mês for positivo; cenários não alteram obrigações ou dinheiro. |
| P2 | Contas recorrentes e parcelas a pagar | Modelos por fornecedor para aluguel, seguro e serviços; competência/vencimento, geração idempotente e revisão das próximas parcelas. | Gerar duas vezes a mesma competência não duplica títulos; mudar o modelo não modifica parcelas já pagas. |
| P2 | Conciliação orientada a exceções | Jornada guiada: importar, verificar fonte/conta/cobertura, resolver diferenças e fechar. Presets de importação por banco e priorização de itens sem correspondência. | Reduzir intervenções manuais medidas no piloto; correspondência ambígua continua exigindo decisão auditada. |
| P2 | Fechamento mensal assistido | Painel por conta com pendências bloqueantes e responsáveis; pacote de evidências e exportação para conferência contábil. Reutilizar os fechamentos já existentes. | Totais exportados correspondem ao snapshot do período; reabertura exige motivo e mantém versões anteriores. |
| P2 | Centros de custo úteis à gestão | Pendências sem classificação, orçamento versus realizado e análises por viagem, veículo, cliente e área quando a origem permitir. | Somar o custo uma vez; pagamentos, adiantamentos e complementos não entram como novo custo. |
| P3 | Integrações de cobrança/pagamento | Após estabilizar o núcleo, avaliar boleto/PIX, remessa e retorno bancário e acompanhamento de liquidação, conforme os bancos utilizados. DOCCOB já existe e não substitui retorno bancário. | Envio, aceite, execução e conciliação são estados distintos; callback repetido não duplica baixa. |

Antes de definir metas numéricas de produtividade, medir tempo de resolução, cliques por baixa, taxa de conciliação automática, títulos duplicados e pendências por idade. A auditoria não mediu esses indicadores com operadores reais.

## Segurança e desempenho: resultado e ações proporcionais

As políticas inspecionadas de movimentos, eventos, títulos, folha e contas bancárias incluem fronteira restritiva da empresa ativa. Também há bloqueio de motoristas nos caminhos examinados. Isso é um ponto positivo; não constitui certificação de todos os RPCs, Storage e consultas operacionais.

O advisor encontrou 3 funções financeiras de acerto executáveis por `anon` como SECURITY DEFINER. A inspeção mostrou que as implementações delegadas exigem acesso financeiro antes das alterações. **Não confirmei uma escrita anônima autorizada.** Recomendo revogar execução anônima desnecessária e adicionar testes negativos preservando o fluxo interno. [Orientação do Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Avisos de RLS sem política em schemas privados não foram classificados automaticamente como falhas: podem fazer parte de um modelo de acesso somente por funções controladas. O mesmo vale para funções SECURITY DEFINER autenticadas. É necessário avaliar acesso efetivo e autoria, como feito na amostra.

O advisor de desempenho retornou 211 FKs sem índice e 600 índices sem uso **no projeto inteiro**, além de políticas permissivas sobrepostas em tabelas de faturas/acertos. Não recomendo criar ou remover índices em massa. O volume financeiro observado era pequeno — 4 contas a pagar, 1 recebível, 1 movimento e nenhum extrato importado — e não comprova comportamento sob carga. Avaliar planos em homologação com volume representativo e priorizar buscas, saldos e joins de evidências. [Orientação sobre FKs](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## Ordem de implementação recomendada

1. **Estabilizar a publicação:** corrigir tipos, conferir os 16 contratos incompatíveis e as proteções locais ainda ausentes no banco. Exemplos confirmados: constraint positiva de pagar e triggers de auditoria material presentes em migrations locais, mas ausentes no catálogo ativo inspecionado. Ensaiar migrations e jornadas com a versão exata do candidato.
2. **Proteger operações:** criação manual recuperável, revisão de edição de recebíveis, capacidades de acesso coerentes e paginação financeira de faturas. Entregar a recuperação central junto dos fluxos migrados.
3. **Destravar o dia a dia:** resolver fila fiscal pela origem, central de pendências, rotina de cobrança e conciliação guiada. Validar com operadores em dados de homologação.
4. **Ampliar gestão:** tesouraria diária, recorrências, fechamento/exportação e análise de custos. Tratar integrações bancárias como etapa posterior, conforme necessidade e bancos reais.

Os critérios mínimos de aceite devem incluir resposta perdida após commit, repetição do mesmo pedido, duas abas, edição concorrente, troca/revogação de acesso, fronteira entre empresas, estorno/cancelamento com histórico e período fechado. Para escala, incluir 501 e 10.000 faturas e medir consultas/listagens no PostgreSQL nativo. Os testes selecionados nesta auditoria não substituem essa homologação completa.

## Validação executada

| Verificação | Resultado |
|---|---|
| 14 arquivos: núcleo, acesso, baixas, fiscal, folha e regressões de pagar | 72 testes passaram |
| 18 arquivos: caixa, extratos, conciliação, faturas, fechamento, despesas, auditoria, acertos, EDI e centros | 111 testes passaram |
| TypeScript do projeto | Falhou: 9 diagnósticos; 2 em BillingEdi e os demais em OperationsDashboard e fixtures/testes |
| Catálogo remoto de RPCs | 12 nomes ausentes e 4 assinaturas incompatíveis; 17 pontos de chamada |
| Jobs financeiros nas últimas 24h consultadas | 1.440 execuções succeeded por job, fiscal e conciliação |
| Navegador autenticado / transações reais / cadeia completa de migrations | Não executados nesta auditoria |

Logs: [núcleo](F:/agvlog-main/audit-finance-tests-20260922.log), [fluxos](F:/agvlog-main/audit-finance-flows-20260922.log), [typecheck](F:/agvlog-main/audit-finance-typecheck-20260922.log).

Nenhum código da aplicação, configuração de produção ou dado financeiro foi alterado. Foram gerados apenas este relatório, suas evidências e os logs de validação.
