# Custo e obrigação após cobrança já cancelada

Migração CLI54915 local:20260911054915_finance_unloading_cancelled_claim_cost_resolution.sql. SHA256461a91487b5d0a67b8a21bbc1a2f65988c9afe2612f74d3f15eab384f6afdeb0.53349 e seus testes congelados não foram alterados.

## Contrato e prova exigida

Mantém RPCs preview_finance_unloading_cancellation e cancel_finance_unloading, com o mesmo DTO de resposta v1. Origem já cancelada comprovada pode ser elegível para cancelar custo e obrigação restantes; effects.collection_cancelled_cents é0. Command acrescenta prior_origin_amendment_id, obrigatório nesse caso, igual ao último evento cancel_origin da cadeia comprovada. Origem ainda ativa rejeita o campo, evitando interpretação ambígua.

O helper privado verifica resolvedor completo, último evento cancel_origin, afterstate igual à origem efetiva cancelada, mesmo título/tenant, statuscancelled, client_id exato e nominal atual igual ao beforeamount preservado pelo cancelamento. Receivedamount deve serzero; vínculos fiscais/closing devem estar ausentes. Statuscancelled sozinho nunca é prova.

Após essa verificação, o contexto remove somente três incompatibilidades esperadas do contexto de correção de origem: origem não ativa, nominal diferente de direito efetivozero e estado diferente de pending. Todos os blockers de histórico financeiro, vínculos fiscais, materializações, data econômica e períodos protegidos permanecem. O grafo privado e o ID anterior participam da revisão.

Writer exige explicitamente o prior_origin_amendment_id sob as mesmas travas/reautorização. Reutiliza o ID anterior no resultado/auditoria e executa somente o filho de custo/pagável com ticket exato. Não chama correct_unloading_origin nesse ramo: não há segundo amendment, segunda perna econômica, alteração no título ou movimento monetário. O evento coordenador liga a resolução de custo ao cancelamento anterior, com collectioneffect0. Replay exige mesmo payload/ator após reautorização.

## Ensaios

unloadingCancelledClaimCostResolution.test.ts: **7 PGlite passaram03:01:00; lint0**. Fixture compartilhada53349 inclui guardas residuais completas75641+trylock81257; nenhum guard foi desligado. Setup usa comandos reais de gasto/descarga e cancelamento auditado privado de origem; ação de custo e prévia usam RPCs públicos e resultado usa schema real. Resolver DTO também validado pelo schema real. Schema completo da prévia atualizado pela UI validou todos os retornos reais, inclusive origem cancelada.

Cadeia real claimcancel→costcancel: KPI15000 continua após retirar só cobrança, depois cai0 com custo/payable cancelados. Collectioneffect0; um único amendment/evento de origem; título integralmente idêntico; dinheiro0; histórico coordenador1; constraints diferidas. Replay retorna mesmo resultado. ID anterior errado/ausente e revisão antiga rejeitam40001. Falha no evento coordenador reverte apenas a tentativa de cancelar custo e mantém o cancelamento anterior da cobrança; nenhum ticket residual. Empresa/perfilmistonegam42501. Legadostatuscancelled criado antes da instalação da guarda, sem amendment, continua bloqueado e custo15000 preservado.

## Implantação e limites

Predecessores privados contexto/coordenador guardados por hash exato, ACL owneronly, securitydefiner e search_pathvazio. Sem alteração de53349 ou grants brutos. Nenhuma aplicação remota, TSC ou PostgreSQL nativo por este agente. Frontend deve rotular cobrança já cancelada e confirmar apenas custo/obrigação restantes; payload preserva ID anterior. Alteração positiva do custo permanece próxima etapa, não implementada por esta extensão.

Regressões adicionais: origemativa após54915 cancela os três efeitos e rejeita prior_origin_amendment_id22023. Fechamento bancário real sem movimentos executou importação/verificação fixture, fila automática real, abertura/cobertura/revisão e close; custo restante fica bloqueado55000 e KPI15000 preservado. Reopen real restabelece elegibilidade. Nenhuma guarda simulada ou desligada; primeira tentativa de close rejeitou fila pendente, resolvida executando o worker real antes da aprovação.
