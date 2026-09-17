# Integração carga/financeiro211800–213156–220847

2026-09-11. Revisão e testes locais; única chamada remota foi SELECT agregado autorizado, nenhuma escrita remota. Root autorizou explicitamente ajustar origem211800 ainda não aplicada, arquivando original.

## Defeito corrigido

211800 guard_driver_settlement_cargo_closed_v1 rejeitava INSERT e UPDATE de identidade de acerto manual com dispatch_trip_idNULL: helper de viagem retornavafalse.213156 já considerava esse acerto liberado, portanto as regras eram inconsistentes.

Alteração mínima: exigir `new.dispatch_trip_id is not null` antes de cobrar fechamento de carga. Nenhuma mudança de ACL, autorização financeira, geração por viagem ou proteção de viagem real. Não permite que viagem não fechada seja aprovada. Original arquivado em `finance-cargo-gate-211800-before-null-fix-2026-09-11.sql`.

SHA256 anterior211800:6432e4b580538f8dbfa518e40c98c4dc4b3cb43eddd81f4b7a027dfa7cdb21c0.
SHA256 atual211800:d961453fa8c1839ce1d481dc7cc4f45621c96e46d9d61ff7a9494657bde2ad27.
Este hash substitui o anterior no parecer de dependências restante.

## Evidência local

14testes passaram em3arquivos, saída0,7.27s, Vitest/PGlite com1worker:

- tripCargoClosedDownstreamGateDatabase:3. Viagem operacional concluída não libera financeiro sem carga fechada; encerramento real libera efeitos uma vez; novo caso positivo de INSERT/UPDATE acertoNULL com boundaryfinanceiro preservado.
- driverSettlementCargoQuarantineDatabase:6. Backfill preserva acertos, bloqueia aprovação/pagamento/lista e mantém gasto operacional disponível; resolução auditada/replay; acertos aprovados/pagos preservados; isolamento ativo/financeiro/admin/identidadehíbrida; novo casoNULL permanece liberado e não gera quarentena.
- expenseStatementJourney:5. Jornada financeira existente e220847 exclui movimento invalidado, preserva guardcarga e recusa drift de contrato.

Log:finance-cargo-integration-review-tests-2026-09-11.log. Foram adicionados testes somente aos2arquivos de carga/quarentena. Fixtures operacionais usam SQL real das migrations, mas helpers de autorização nesses2testes são configurações controladas que simulam owner/operator/driver/misto/workspace. Isso testa a invocação dos boundaries; não é prova independente de Auth remoto nem substitui testes globais de can_access.

## Impacto remoto medido, somente leitura

SELECT emqcvnsdrbcchaxvawcngk:2acertos totais;2semviagem;0comviagem;0candidatosquarentena;0referência de viagem órfã/outraempresa. Consulta usou a condição real de cargo controlclosed+closed_at. Sem IDs/dados pessoais na saída.

Consequência:213156não produziria quarentenas nesse instante; não é garantia para dados criados depois. Sem a correção211800, novosacertosNULL continuariam indevidamente bloqueados. Acertos já existentesNULL não são backfilled nem alterados.

## Instalação

Ordem211800 corrigida →213156 →220847, com cadeia financeira anterior necessária.213156cria2tabelasRLS e backfillauditado; concede SELECTgated aosautenticados e ALLservice_role explicitamente. Guardfinanceirofalse mantém RPCs/boundaries fechados; triggers operacionais continuam ativos.220847depende do corpoexpense_options comcargohelper e active_movements. Nenhuma alteração de guard remoto foi executada nesta subtarefa.
