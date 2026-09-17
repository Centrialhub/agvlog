# Restante financeiro 171503 → 224136 — ordem e bloqueios

Revisão estática local em2026-09-11; sem SQL remoto, testes, Sites ou alterações de produto. Base informada pelo coordenador: produção até152557; outra frente ensaia a cadeia até170539. Esta revisão começa DEPOIS de170539 e não comprova que os predecessores estejam instalados.

Manifesto atual: `finance-remaining-171503-224136-manifest-2026-09-11.json` —40arquivos, ordem, bytes, SHA256 dos bytes atuais, funções públicas e alvos literais de patches. O extrator de alvos é auxiliar: loops/dynamic SQL podem adicionar dependências além da lista. A análise agrupa superfícies e riscos; não é uma prova de execução integral desses40arquivos.

## Grupos para ensaio/aplicação sequencial

Prefixos completos começam em20260910. Não pular ordem interna; manter gate=false e workers já pausados durante a cadeia.

| Grupo | Ordem do manifesto / prefixos | Dependência principal e entrega |
|---|---|---|
| A estoque |1–4:171503,171734,172624,173336|Aquisição170454/reader170539 e fechamento/corte legado anteriores. Atribuição de consumo com linhas e reservas, preços unitários fracionários, leitores; prova de cadeias já pagas em folha/adiantamentos; reafirmação RLS/ACL estoque.|
| B caixa |5–8:173906,174142,174822,175310|Abertura física141240, fechamento bancário/guards/corte legado completos. Contagem final, preview/fechar caixa, histórico manual, correção de identidade bancária para não colidir contas físicas sem agência/número.|
| C cancelar custo |9–15:175641,175733,180040,180245,181257,181549,182406|Custos/lotes/manualexpense, associações legado/manutenção/estoque/folha e guards de período anteriores. Cancelamento append-only só de custos elegíveis sem dinheiro; readers e carteira pagável; ACL cash reafirmada; cancelamento separado de manualexpense identificado por payable_id.|
| D movimentos ativos |16–24:182541,182830,183438,183442,183506,184213,184543,185338,185517|Ledger, links de pagamento/recebimento, conciliação, abertura/fechamentos e cadeias pagas completos. Fundação de invalidação, histórico preservado, projeções apenas ativas, guards de novos usos e provas de origens/baixas. Ainda não disponibiliza comando público de invalidação.|
| E correção de movimento |25–28:190516,190635,191905,192831|Todo grupoD + guards de fechamento reais. Contexto/preview, fotografia de runtime, writer privado com tickets e baseline, depois promoção pública. Não suprimir testes/readiness para contornar falhas.|
| F demonstrativos/histórico |29–33:193723,195941,201323,202421,203516|Snapshots de fechamento banco/caixa, créditos e pagamentos/associações, cobranças de descarga preservadas. Pacote monetário por contas; baseline/captura de recebíveis; histórico paginado, pagamentos página50 e fluxo descargas por fornecedor.|
| G descarga |34–38:205941,210433,211156,211740,212550|Origem charge↔receivable e financial_snapshot existentes, histórico financeiro/dependências/fechamentos. Protege identidade/valor/fornecedor; contexto informa divergência sem reabrir baixa; reparação de projeção com ticket, preview e promoção pública. Não altera origem comercial real.|
| H integração/acesso |39–40:220847,224136|220847 depende explicitamente de211800 operacional, além de active_movements.224136 exige private.is_request_tenant_member e formato esperado de can_access; preserva gate constantefalse.|

## Bloqueios reais e pontos que exigem tratamento

1. **Dependência fora do nome finance**: `20260910211800_canonical_trip_cargo_close_gate.sql` define private.trip_cargo_is_closed_v1 e substitui expense_options.220847 exige que o corpo de expense_options já contenha esse helper e tenha exatamente uma fonte de movimentos esperada. Sem211800, falha finance_cargo_expense_options_contract_changed. SHAatual211800: `6432e4b580538f8dbfa518e40c98c4dc4b3cb43eddd81f4b7a027dfa7cdb21c0`. Não instalar220847isoladamente nem remover o guard de carga. Coordenar ensaio operacional desta migration antes220847.
2. **Adjacente operacional deve ser decisão explícita**: `20260910213156_quarantine_legacy_settlements_until_cargo_close.sql`, SHA`68a7b3d136871db47094bfa170b62c6abef78f2acc1fcfffd12d12a66ecd9d4c`, depende de cargo gate e trata acertos legados. Não foi inserido silenciosamente no manifesto financeiro40; precisa revisão/ensaio próprio de efeitos nos acertos existentes. A ordem global natural é211800 antes212550 e213156 antes220847; seguir composição global validada pelo coordenador.
3. **195941 tem escrita histórica real**: BEGIN/COMMIT explícitos; lock tenants SHARE ROW EXCLUSIVE e lock receivables no mesmo modo NOWAIT. Captura coverage por empresa e BASELINE de TODOS os recebíveis existentes com pagador preservado. Não cria receita/baixa, mas grava dados e ocupa espaço proporcional. Falha55P03 pede retry da migration inteira, não continuação de um fragmento; órfão de tenant falha23514. Conferir compatibilidade do executor com a transação explícita sem produzir commit parcial. Triggers passam a capturar INSERT/UPDATE/DELETE imediatamente, inclusive com gatefalse; TRUNCATE de origem/histórico é proibido. captured_at/event_order NÃO provam ordem decommit nem conhecimento histórico anterior.
4. **190516/191905 gravam baselines de runtime**:190516 exige readiness completo antes de congelar definições/ACL/triggers/view;191905 congela writer/tickets/guard. Drift posterior impede comando. Não editar/recriar snapshot para forçar elegibilidade: comparar definição esperada e testar cadeia final.192831 só promove dispatcher; mantém privado sem EXECUTE de authenticated. Fotografias são configuração de segurança, não certificação de release. A ativação final deve incluir verificação dos dois baselines e todos guards.
5. **224136 NÃO ativa produção staged**: retorna sem substituir corpo quando can_access é selectfalse. A publicação completa ainda requer procedimento explícito de ativação com definição workspace-aware, negação semclaim/mismatch/driver/misto, além de retomada controlada dos workers. Não restaurar o can_access original apenas baseado em memberships.

## Efeitos imediatos apesar do gatefalse

-171503 cria claims/reservas/linhas e triggers de preservação no estoque;172624 adiciona proteção diferida de materializações pagas e amplia guard de fechamento. Não atribui consumos existentes automaticamente.
-175641/181257 instalam triggers em pagáveis, pagamentos, alocações, itens de folha/acerto e obrigações. Esses triggers de integridade atuam sobre escritores existentes;181257 troca espera de lock do guard de cancelamento por try_lock/40001. Cancelamentos só ocorrem por comandos elegíveis, não durante aplicação.
-183442/183506 instalam guards de conciliação, referências e pagamentos (BEFORE e deferred). Relações que apontem movimentos inválidos são recusadas; alguns caminhos exigem can_access e podem bloquear writers legados enquanto gatefalse. Não classificar o bloco como puramente aditivo/inativo.
-183438/185338 alteram leitores/provas para excluir movimento invalidado dos valores ativos e preservar histórico. Baixa histórica não é desfeita automaticamente nem título reaberto.
-205941 instala BEFOREUPDATE/DELETE na origem recebível e BEFOREINSERT em charge/recebimentos, restringindo alterações de fornecedor/valor/identidade e estados fiscais. Ainda permite metadados e recálculos legítimos.211156 acrescenta exceção por ticket exato para reparação auditada; nenhum reparo é chamado na migration.

## Cron, RLS e permissões

Busca nos40arquivos não encontrou referência `cron.`; não há novo scheduler a pausar nesta faixa. Workers anteriores continuam responsabilidade do rollout staged já preparado. Não foi identificada chamada HTTP ou criação de bucket nesta faixa.

Novas tabelas financeiras usam ACL restrita, políticas SELECT autenticadas com gate e eventos imutáveis.173336 reafirma explicitamente fronteira das6relações estoque;180245 reafirma contagens/reversões caixa. Tabelas privadas de tickets/baselines/captura não recebem DML de cliente. Conferir RLS+relacl no banco após aplicar, inclusive tabelas privadas. CREATE OR REPLACE e patches pg_get_functiondef preservam ACL/OID anterior; predecessor ausente não deve ser substituído por função com EXECUTE PUBLIC padrão. Preservar revokes/grants e blocosDO integralmente.

## APIs que ficam indisponíveis até seus grupos

- Estoque: get_finance_stock_consumption_context, preview_finance_stock_consumption, attribute/reverse consumption —grupoA.
- Caixa: record/reverse_finance_cash_period_count, preview/close_finance_cash_period, get_finance_cash_period_counts —grupoB.
- Custos: preview/cancel_finance_expense, preview/cancel_finance_manual_expense e get_finance_payable_portfolio —grupoC.
- Correção: preview_finance_movement_correction —190635; void_finance_manual_movement —192831. UI não pode tratar preview sem writer como comando disponível.
- Demonstrativos: get_finance_period_money_package —193723; get_finance_receivable_history —201323; get_finance_receivable_payments_page —202421; get_finance_period_unloading_flow —203516.
- Reparação: get_finance_unloading_projection_repair_context —211740; repair_finance_unloading_projection —212550.

A lista exata de funções públicas extraídas por arquivo está no JSON. Frontend já publicado antes dessas APIs pode mostrar indisponibilidade controlada; login Sites e workspace funcionando não comprovam financeiro completo. Após cadeia+ativação: testar AGV/LIRA isoladas, motorista/misto negado, upload scanner real configurado, preview/replay/retorno, carteira e movimentos, gastos em lote, conciliação/fechamento e descargas. Este relatório não afirma que esses testes ou ativação foram executados.
