# Origem versionada de descarga — implementação privada em revisão

Migração CLI local `20260911045402_finance_unloading_origin_amendments.sql`. O ramo local integra leitores econômicos, histórico de gastos e wrapper público separado. Não representa conclusão da correção coordenada de custo/dívida. A alteração coordenada do próprio custo/pagável continua requisito distinto, assim como os casos com dinheiro já recebido.

## Estado implementado

Tabela privada append-only `finance_private.unloading_origin_amendments`: mesma charge/receivable, ordinal, previous_id, request_id, operation, revision_before, before_state/after_state, effective_on, actor/name/reason, evidence, created_at. Unicidade por tenant/charge/ordinal impede bifurcação. Trigger verifica tenant/charge/título e constraint diferida exige cadeia auditada completa; UPDATE/DELETE negados. Não se cria segunda descarga nem se muda a charge original.

Resolvedor privado `unloading_effective_origin(t,charge)` retorna `{version:1,tenant_id,charge_id,receivable_id,verified,issue,original,effective,revision,history,last_effective_on}`. effective é null se a cadeia não for comprovada. Estado `{supplier_id,supplier_name,amount_cents:string,status:'active'|'cancelled'}`. Origem usa somente charge/comando/evento imutáveis, evitando varrer o grafo inteiro a cada recebimento.

Histórico completo por ordinal: `{id,previous_id,ordinal,revision_after,operation,effective_on,created_at,actor_id,actor_name,reason,before,after,economic_effects:[{leg:'release'|'recognize',supplier_id,supplier_name,amount_cents:signedstring}]}`. Amend gera retirada do fornecedor anterior e reconhecimento ao novo (mesmo quando fornecedor não muda); cancel gera só retirada. Data econômica explícita >=ocorrência original/última versão e <=dia atual. Isso não prova posição as_of, conhecimento passado ou ordem de commit.

Contexto privado `unloading_origin_correction_context(t,charge,proposal)` recebe `{operation:'amend_origin'|'cancel_origin',supplier_id?,amount_cents?,effective_on,collection_right_only:true}`. Retorna original/efetivo/target/history/dependencies/blockers/eligible/can_correct/can_executefalse, revision, efeitos monetários prospectivos e `_evidence` privado. Wrapper público futuro deve retirar `_evidence`. Cancel não aceita fornecedor/valor livres.

Writer privado `correct_unloading_origin(payload)` recebe `{version:1,tenant_id,request_id,charge_id,revision,proposal,reason}`. Retorna `{version:1,tenant_id,actor_id,request_id,charge_id,receivable_id,amendment_id,confirmed:true,cash_changed:false,cost_changed:false,payable_changed:false}`. Somente owner/admin com can_access, sem grants authenticated/service. Trava fiscal→finance→membership/driver→charge→grafo financeiro→fornecedores→custos/pagáveis; reautoriza após espera antes de replay. Ticket privado com txid/ator/target/before/after exatos libera só transição esperada no205941; outras guardas ledger/fechamento/captura permanecem. Falha de auditoria reverte tudo.

Redução150→120 altera título para120 e preserva custo150/payable. Cancel mantém nominal anterior do título e statuscancelled, enquanto direito efetivo passa a0. Isso preserva nominal histórico e não inventa pagamento/devolução. Histórico pago, crédito, correção, materialização dependente do título e período protegido geram blockers específicos herdados do grafo211156. Dependências exclusivamente do custo intacto são informativas; mudar custo exige outro comando coordenado, não ignorar essa diferença.

## Integrações realizadas no ramo local

Guard205941 valida novos recebimentos contra origem efetiva; sem ticket, edição direta continua negada. Repair211156 fica inelegível após qualquer amendment para não restaurar o original e apagar a correção. Context210433 informa cancelamento auditado com `finance_unloading_origin_cancelled` e mantém divergência distinta.

O helper de contexto acrescenta `unloading_origin:{version:1,charge_id,verified,revision,amendment_id,effective}`. Writer183929 já grava o snapshot financeiro inteiro: before_snapshot captura essa versão sem modificar o writer de recebimentos. O fluxo51405 usa esse marker, nunca o resolver corrente para reatribuir pagamento antigo. Eventos anteriores sem marker conservam prova original. A promoção52521 separa dispatcher definer autorizado e wrapper invoker; writer e contexto bruto permanecem privados.

Guardas predecessoras verificadas por MD5/ACL/search_path:
- guard_unloading_receivable_source: bdf896097eb666ff99c9d1f88dcd3aa4;
- unloading_projection_repair_context: fe0b133442bab6f51ec6a0065b68629b;
- unloading_receivable_source_context:329fcc118795c2c5a31c4dbc32edf7bc.

## Integrações e evidência final local

51405 acrescenta fluxo v2: cada alteração produz pernas release/recognize assinadas, cancelamento apenas release. origin_totals preserva cobrança original, adjustment_totals registra ajustes e net_origin_totals soma ambos. Pagamento/devolução conserva fornecedor e valor nominal da versão capturada no before_snapshot. Linhas originais explicitam campos de amendment nulos. Ajustes não representam dinheiro: money_coveredfalse e closure_ids vazios. Seleção por fornecedor ocorre após resolver a versão do recebimento; claims globais de frete e coberturas bancárias permanecem no cálculo anterior.

51729 acrescenta unloading_origin apenas às linhas paginadas do list_expenses final após44823. Custo, fornecedor prestador, comprovante original e totais permanecem separados da cobrança vigente. Fixture usa definições reais de tabelas de metadados/DTO para a consulta de anexos; não simula validação de arquivo nem contém artefatos fabricados utilizáveis.

52521 publica get_finance_unloading_origin_correction_context e correct_finance_unloading_origin somente para authenticated; safe preview remove _evidence e valida tenant/actor/charge. can_execute exige eligible+can_correct e ACL de invocação pública/dispatcher, mantendo writer privado. Isso representa capacidade de invocação, não uma certificação de todos os corpos de guardas.

unloadingOriginAmendments.test.ts: **7 PGlite passaram às02:30:29; lint0**. Comandos reais charge/batch, sequência150→120→trocaA/B→cancel preservando mesma charge/custo/payable, constraint diferida, ACL/cross/misto, recebimento preservando marker, bloqueio após história financeira, stale revision, retenção e falha audit atômica. Recebimento contra origem corrigida seguido de extrato, conciliação, abertura, cobertura, aprovação de corte e fechamento bancário reais: coveredtrue; reabertura remove cobertura mantendo recebimento registrado. Parsers reais de fluxo v2, expenseHistory, resolver, preview e resultado. Wrapper público executa e repete o mesmo comando, nega perfil misto; revogação EXECUTE faz can_executefalse.

Cancelamento no preview protege o mesmo OLD/NEW do writer: conserva nominal do título e muda statuscancelled; direito efetivo é0. A prova de fecho exercita recebimento/fechamento/reabertura, não uma corrida nativa. Ensaio específico instalou o builder real baseline suportado pela134948, DDL/log reais e a composição canônica134948, materializou gasto150 no acerto e corrigiu cobrança120. Comparação integral do acerto e de todos os itens/snapshot permaneceu idêntica. Materialização direta do título em driver_settlement_items gerou blocker com ID e writer55000. É uma prova de composição financeira, não do pipeline operacional completo de custódia atual. DDL da fixture foi ampliado com colunas reais; nenhum builder, cálculo ou log foi substituído por retorno de sucesso. Não foi exercitado o gerador completo de folha nesta rodada. Não foram desabilitadas guardas para alcançar positivos.

Hashes SHA256 congelados para revisão:
-45402: cc8b23cf305fe29b82f0701d08fa76623212127c879ea2789200b9bb69c64122
-51405: d2f1abd8d7017c8aa4ec6686490d9f2f73e062b95321b9dda05d793a43fc8e1c
-51729: d4cc42e47911e551d5036b1ae559f3b975f7bee5553c66e5401301d54d386020
-52521: d3794e0ba9754a0da92959438d1ba641e677d5e4fe323d818ececdbbb98fdab0

## Próxima resolução coordenada de custo e dívida

A correção de cobrança não altera o serviço comprado nem seu beneficiário. O custo original continua150 mesmo quando a cobrança vira120 ou0. Para custo errado,175641 atualmente bloqueia unloading explicitamente, e213959 mantém unicidade de expense.unloading_id; cancelar e criar nova descarga não é solução. O incremento deve manter a mesma identidade com evento de retificação de custo/obrigação, projeto efetivo único usado por recorded_costs, KPI, histórico de gastos, claims de pagamento e canonical_trip_costs. Payable aberto exato precisa mudar na mesma transação e com evidência do beneficiário original do batch, sem assumir que ele é fornecedor da cobrança.

Antes de habilitar esse comando: bloquear pagamentos/alocações/links históricos e materialização de acerto/folha dependente do custo; validar source_payables único e nominal/status/beneficiário; preservar OLD/NEW de fechamento; ticket privado estrito para custo/pagável; revision e auditoria conjuntas. Cobrança só muda se proposta incluir alteração explícita adicional. Casos com dinheiro já pago exigem cadeia de regularização própria e permanecem pendentes, não resolvidos por net0.

Nenhuma aplicação remota, TSC, PGnativo ou emissão fiscal por este agente.
