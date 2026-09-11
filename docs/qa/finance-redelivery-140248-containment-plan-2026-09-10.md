# Contenção localizada da reentrega140248 — proposta de ensaio

Artefato: supabase/rollouts/finance_redelivery_140248_containment_local.sql. SHA256893b0342c185037306c474ac4a45419bead7e086b373cbd7f40c2215b2df9744. Nenhuma aplicação remota deste artefato. Destina-se a produzir evidência adicional para revisão, não a contornar a rejeição da migration original.

1. Pausar novos envios de reentrega e drenar pedidos em andamento. Preservar outbox, request_id e anexos. A existência de função nova não cancela frames que já executavam. O responsável pelo tráfego confirma drenagem.
2. Script inicia transação e exige barreira fiscal_documents SHARE ROW EXCLUSIVE NOWAIT. Se ocupada, aborta sem alterar gate nem interromper escritor. Não terminar sessões, remover guards ou ampliar timeout automaticamente. Reavaliar após drenagem.
3. Confere assinatura/hash exato do request140248, corpo exato do gate ativo, grant público esperado, tabela/RLS e ligação/flags reais do trigger. Versões posteriores/deriva são recusadas. Não é script universal para qualquer etapa.
4. Substitui somente gate: recusa criação/headchange de tentativa com55000. Não troca request_document_redelivery nem leitores nem construtor financeiro. O novo pedido cria evento/tentativa dentro da mesma transação, mas falha no UPDATE final; tudo deve reverter, inclusive aposentadoria de POD. Replay de pedido já confirmado é retornado antes da mutação e permanece recuperável.
5. Tentativa existente continua com o mesmo head: anexar seus itens reservados, ler histórico e concluir entrega continuam sob guards normais. Contenção não suspende todo sistema operacional. Nova tentativa subsequente permanece pausada.
6. Não há restauração automática: retomar exige contrato forward exato revisado, preservando IDs, revisões e pedidos. Não restaurar writers antigos, unique global de POD, nem apagar snapshots.

Ensaio solicitado ao dono exclusivo PG: comparar businesssnapshot antes/depois instalação; confirmar replay; novo pedido independente falha55000 semresíduos; leitor antigo/histórico preservado; jornada da tentativa já existente segue; trigger/ACLdrift recusa se possível; barreira ocupada55P03 sem alteração. Oito casos de140248comhashfixo continuam base separada. Resultados serão registrados pelo executor nativo, não presumidos por este documento.

Limite: contenção prospectiva não desfaz pedidos confirmados nem corrige automaticamente dados já incorretos. Não é rollback de negócio. Só atesta capacidade de impedir novas liberações sem destruir a história quando ensaio confirmar. O gatefinance can_access=false não substitui esta pausa operacional.
