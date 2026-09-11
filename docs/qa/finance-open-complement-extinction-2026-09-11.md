# Extinção privada do complemento aberto

Candidata criada via CLI: `20260911092319_finance_unloading_open_complement_extinction.sql`.
SHA256: `3fb732aafd84b75b99baa471bdada3e7c472ebe8c03e209a968cfd511741b263`.

Nenhuma aplicação remota, promoção pública, alteração de UI, stage ou commit nesta tarefa. Predecessor real testado: 81653 → 85400 → 83307 → 90910. Os arquivos dessas migrações permanecem intactos.

## Contrato privado

`finance_private.open_complement_extinction_context(t uuid, charge uuid, proposal jsonb)` e `finance_private.extinguish_open_unloading_complement(payload jsonb)`.

Proposal: `{amount_cents: string, dispositions: [{source_kind: "expense_allocation", source_id: uuid, applied_cents: string, responsible_id: uuid, disposition_type: "driver_custody"}]}`. Cada alocação precisa aparecer exatamente uma vez; aplicações não negativas somam o custo proposto positivo, limitado ao montante alocado. A identidade do motorista e a natureza de adiantamento são contraprovas da fonte real, nunca inferidas de texto livre.

Payload: `{version:1, tenant_id, request_id, charge_id, expense_id, payable_id, proposal, revision, reason}`. A revisão é a prévia completa incluindo evidência; replay exige ator, ação e corpo idênticos após reautorização. A prévia continua privada, `can_execute:false`, com campos de 81653 mais proposta/disposições, alvo cancelled/complemento zero e efeitos separados. `_evidence` só existe no helper privado.

Resultado: `{version:1,tenant_id,actor_id,request_id,charge_id,expense_id,payable_id,extinction_id,regularization_id,confirmed:true,effects,payable_status:"cancelled"}`.

## Estado e invariantes

O journal append-only `finance_private.open_complement_extinctions` registra a revisão anterior, custo anterior completo, payable OLD/NEW exatos, origem e proposta; FK diferida o liga à mesma identidade de regularização/disposições72557. Nenhuma coluna é adicionada a expense ou aos snapshots antigos.

Exemplo 150/100 alocado/50 aberto → custo100: mesmo título nominal50 com status cancelled; reserva100 aplicada integralmente e residual0. Exemplo → custo80: mesmo título nominal50 cancelled, reserva100, custo aplicado80, responsabilidade20 do motorista. Somente status e updated_at do título mudam, por ticket privado exato; nenhuma movimentação, alocação ou pagamento é reescrito ou liberado.

Uma cadeia positiva anterior 150→120 é verificada integralmente contra o snapshot do título antes da extinção; seus eventos não são reaplicados depois da nova regularização. O resolver que antecede devoluções reconhece a nova transição, e a camada74603 continua validando retornos reais nas mesmas tabelas e na capacidade compartilhada. A cobertura apresenta complemento devido0 separado do nominal histórico50/20. O DTO do custo ganha `complement_extinction` apenas nas novas versões, para futura integração de apresentação.

Novas tentativas de aprovação, pagamento, alteração de alocação/cancelamento bruto ou liberação da saída encontram as guardas existentes de disposição. Dinheiro efetivamente retornado reduz apenas a responsabilidade aberta e ocupa capacidade da entrada; não libera a saída original.

## Provas locais

`npx vitest run src/test/unloadingOpenComplementExtinction.test.ts`: **9 passaram**, saída0, execução final99166 encerrada em 2026-09-11 06:34 local. ESLint do arquivo: saída0.

- Duas correções reais com igualdade/excedente, preservando expense JSON, nominal do título e movimento usado100.
- Correção positiva prévia seguida de extinção, mantendo o journal81653 byteequivalente.
- Devolução canônica real10: residual histórico20, returned10/open10, custo80 e reserva100 intactos; entrada ocupa10.
- Revisão obsoleta40001; falha no evento reverte título, tickets e journals; retry passa.
- Outro tenant, driver misto e execução pública de helper privado negados.
- Acerto materializado pelo builder real bloqueia; obrigação aprovada e paga por comandos reais também bloqueia sem alterar pagamento.
- Aprovação posterior e remoção da reserva original negadas.
- Proposta incompleta ou responsável trocado bloqueados, inclusive no residual0.
- Cada setup compara os resolvers da regularização paga preexistente antes/depois da candidata: resultado completo byteequivalente.

Nenhuma guarda foi desabilitada para fabricar sucesso. A fixture usa os writers reais e adaptações de dependências já documentadas nos helpers anteriores; não é uma prova de Auth hospedado, navegador ou concorrência PostgreSQL nativa.

## Limites deliberados ainda abertos

Esta candidata não trata complemento já pago, acerto/folha materializado ou período fechado: prévia lista dependências existentes. Alocação que usa um pagamento sem prova estruturada da responsabilidade não é convertida em dívida de motorista. O domínio é correção para custo positivo; custo zero/cancelamento integral permanece no fluxo separado e não foi alegado como resolvido. UI/contrato público precisam integrar o novo DTO antes de qualquer promoção. Não foi criado writer público isolado.
