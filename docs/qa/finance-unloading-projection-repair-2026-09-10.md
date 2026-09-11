# Reparação da projeção da descarga — 2026-09-10

Core privado: `20260910211156_finance_unloading_projection_repair.sql`. Consulta pública somente leitura é etapa separada211740; não há grant de execução do writer.

Restaura apenas client_id e amount do título a partir da charge original comprovada por pedido record_unloading, evento original, IDs, ator, valor, ocorrência, comprovante e snapshot preservado. Não consulta notas atuais para inventar origem. Título deve pending, sem vínculos fiscais/closing ou histórico de pagamentos/comandos/créditos/materializações do próprio recebível. Histórico antigo não é apagado e net0 não transforma título pago em elegível.

Custo do lote vinculado por unloading_id é informativo quando coerente com o valor original; prestador do custo pode ser diferente do fornecedor devedor. Payable e snapshots de acerto/folha ligados apenas ao custo permanecem informativos e intactos. Referências explícitas ao recebível bloqueiam. Dependências de fechamento reaberto permanecem no fingerprint sem bloqueio eterno; guard real de fechamento verifica OLD e destino antes de escrever.

Writer exige owner/admin mais can_access, fiscal→finance→grafo, reautorização antes de replay e revisão após travas. O destino é calculado pelo servidor, incluindo updated_by e updated_at. Ticket privado contém txid/tenant/charge/title/request/actor/revision e JSON completos antes/depois; consumido uma vez no gate de origem do205941. Não libera DELETE nem alteração de outros campos, não pula ledger/fechamento/histórico, não usa GUC. UPDATE, repair history, finance_event manual e finance_command são atômicos.

DTO externo planejado é normalizado, sem _evidence; private context mantém prova completa para revisão/ticket. Histórico expõe IDs/ator/motivo/instante e projeções antes/depois. `can_execute=false` nesta fase. Writer/rawcontext/tickets/tabela histórica sem grants públicos. Eventos unloading_projection_repaired entram em manual_only do audit reader.

Sete testes PGlite reais + ESLint passaram: restauração/replay; batch real com prestador diferente e custo/payable preservados byte a byte; recebimento histórico bloqueado; stale/ACL/escrita direta; falha audit derruba toda a transação; audit manual e replay revogado; operador lê/admin repara/motorista misto negado. Root validou wrapper com schema produção e batch real. Fixture reutiliza fechamento bancário e recebíveis reais; extrai DDL real de driver_settlement_items e finance_fiscal_receivable_origins, com pais fiscais remotos fora da fixture. Não afirma processamento fiscal nem acerto completo nesses testes.

Não executado nesta frente: PostgreSQL nativo, TSC, implantação remota. Antes de promover writer público: revisão final, disputas nativas (baixa/row-first/revogação), ticket residual e fechamento real afetado. Fluxos após regularização de histórico financeiro, alteração/cancelamento da própria charge e correção coordenada de custo/dívida continuam pendentes; este reparo não os substitui.
