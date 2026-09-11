# Jornada integrada: saída, lote, OFX e conciliação — 2026-09-10

Resultado final: **3 testes PGlite passaram**, ESLint passou. Arquivos `src/test/expenseStatementJourney.test.ts` e `src/test/helpers/expenseStatementJourneyDatabase.ts`. Nenhuma migration alterada, nenhum PostgreSQL nativo/TSC ou escrita remota executado por esta frente.

## Provas executadas

1. `record_finance_movement` registra saída500 ao motorista. `record_finance_expense_batch` cria combustível300 + alimentação180 vinculados à MESMA saída; replay não duplica. Histórico real mostra custo480/alocado480/complemento0; seletor real mostra remaining_cents2000. Recibos têm objetos/metadados e passam pela proteção220941. Bytes OFX reais contêm débito500; `readOfxStatement` lê, SHA256 identifica original; `intake_finance_statement` registra; `verifyStatementSource` baixa os bytes do adaptador local, relê/compara e grava `rows_match` pela RPC service_role. Authorize consulta `finance_private.can_access`, sem sucesso constante. Conciliação manual real com revisão+replay deixa1grupo,1movimento500, extrato-500 separado e nenhum payable. Não se somam dinheiro e extrato.
2. Custos530 sobre saída500 geram apenas payable30 para o motorista, mantendo1movimento. Histórico real mostra530/500/30.
3. Viagem completed com custódia returned não é liberada: predicate/guard reais211800 rejeitam seletor e lote com trip_cargo_not_closed, deixam0custos e preservam a saída previamente registrada.

## Integração de definições

Base `createActiveMovementOptionsDatabase`: cadeia real de recebíveis/operações, ledger/lote, capacidade e oito leitores ativos84543. Acrescentados intake/verificação/consultas/identidade/audit/grupos/workspace/histórico de extrato; OFX020543, conta nativa021404, referências automáticas022059/023208, período023911, reauth142923, guards183506 e reconciliação ativa183442; proteção de recibos220941 e histórico/totais atuais175733. As funções finais de custódia211800 são extraídas literalmente (predicate, guard do lote, expense_options) e o trigger real é instalado. DDL de trip_cargo_controls142606 preserva suas restrições/FKs.

Fixture não é todo o schema produtivo: Auth usa adapter de auth.uid/roles e cadastros locais, Storage usa catálogo+bytes em memória associados ao caminho/hash. Esses adapters transportam dados e não substituem o verificador ou comando por sucesso falso. Estado inicial de custódia fechada é semeado; este teste não executa o fluxo físico de fechamento de carga. O OFX não prova abertura/saldo final desta jornada; esses valores não são usados para fechar período nem fabricar saldo contábil.

## Achado adicional de revisão

211800 redefiniu expense_options usando public.finance_movements e perdeu o filtro active_movements de84543. O root foi informado antes de rollout: um movimento invalidado pode aparecer como candidato, ainda que o guard final rejeite seu uso. Não corrigi migration de outro responsável. Os três testes desta prova usam movimento ativo e não alegam resolver essa regressão.

## Limites de disponibilidade

Passar estes testes prova a composição SQL/worker local dos caminhos descritos. Não prova navegador, sessão Supabase real, upload de rede, execução Edge/cron hospedada, todas as migrations aplicadas em produção ou RLS de todo legado. Root é o único responsável pelo rollout autorizado e pela conferência pós-aplicação. O executor sandbox sofreu falha de inicialização; os comandos locais foram executados com escalada explicitamente aprovada, sem contornar rejeição de segurança.

## Regressão211800 corrigida e validada localmente

Atualização: **5 testes passaram + ESLint** após aplicar a migration aditiva do root `20260910220847_finance_cargo_expense_active_movements.sql` na fixture (default installCorrection=true, opcionalfalse). Antes do fix, o novo teste reproduziu seletor oferecendo UUID invalidado; lote já recusava finance_movement_voided atomicamente. Depois: seletor omite, lote recusa, movimento original/evento original/void persistem; aplicar fix2x mantém definição idêntica. Contrato de custódia alterado faz migration recusar e rollback mantém função. Custódia aberta continua bloqueada e jornadas500/480/OFX e complemento30 continuam verdes.

Invalidação é estado inicial semeado na tabela real finance_movement_voids com FKs/pedido original real e evento append-only, sem desabilitar guard. Esta fixture não instala o writer público de invalidação e não finge tê-lo executado; esse comando tem suite própria. O objetivo aqui é provar leitores/allocations sobre estado invalidado existente. Nenhuma migration foi alterada por este agente e nenhuma aplicação produtiva foi feita nesta rodada.
