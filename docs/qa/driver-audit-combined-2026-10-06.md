# Candidato combinado da auditoria motorista — 6 de outubro de 2026

O SHA/tree desta árvore é fixado no handoff externo depois do commit. Este candidato reúne as correções entregues; resultados anteriores não são herdados como aceite final. Réplica e retestes nativos permanecem com o revisor exclusivo.

| Fonte preservada | Commit |
|---|---|
| operational-route-audit-20261006 | c244aa66012774aa60fd4df45b7c548e51c7a5b9 |
| driver-cargo-weight-identity-20261006 | d8d83a124493c7cc2e7da72ca09a9accf4869654 |
| delivery-live-details-f08-f10-20261006 | 661d8b44d24dc1046ca4c87c5ce5191cca954a76 |
| driver-checklist-stops-f02-f09-f11-20261006 | b40f0ab8359371b60d2f1093519878ef4dc415e3 |
| driver-fiscal-file-f05-20261006 | c146acfabfa05aa603c412f64309e9d219106594 |
| driver-cargo-weight-server-20261006 | b68c736482737eb2d56beece8344014868d2f029 |
| driver-fiscal-file-binding-20261006 | fd0d6b3b7083c53e681e8eb822ba4583c2ffdde5 |

As mesclas mantêm a ancestralidade de cada entrega e não substituem branches ou reescrevem commits. integration/local permanece deda6fd1fa765648f8de1785a1a7693081ad11bb; pin publicado63278f7ef77dd1c4e0db7d9e7219ca48280ee18a. Fonte61ad/PWA b03/c461, manual32, task-2 e serviços do revisor preservados.

A5 corrige o trigger legado changed_by/changes via writer fechado, preservando OID/ACL/binding/RLS/CAS e movendo somente o helper interno para private. Cargo combina duas casas kg/half-up com RPC servidor, fonte bruta/histórico/replay preservados, e identificação da viagem correta. Checklist resolve indisponibilidade offline finita; Paradas inclui datas no fuso do usuário; ocorrências traduzem severidade. Entregas deriva detalhes atuais por ID/contexto e acrescenta descrições ARIA. F05 transporta somente PDF/XML existentes autorizados, com credencial só servidor e revalidação do binding não secreto além do token após GET.

F05c146 permanece no histórico: a revisão descobriu rebind congruente com token igual; regressões CT-e/NFS-e reproduziram200 indevido antes do patch. O sucessor corrige esse caso, sem proxy/shared/config/migrations adicionais ou emissão. Não há deliver, refresh ou geração on-demand nesta nova Edge.

## Banco e inventário

Os26 forwards originais e os manifests13+13 permanecem byte-identicos. O inventário suplementar separado fixa os hashes dos dois manifests anteriores e dois novos forwards, em ordem:

1.20261006124418_restore_operational_route_name_audit.sql
2.20261006131127_enforce_driver_trip_cargo_weight_precision.sql

Total candidato28; apenas candidatos, nenhum aplicado à réplica por esta frente. Inventário exato rejeita extras/desconhecidos/tamper e não representa aprovação de baseline. Revisor confirma ledger/catálogos/fingerprints/ACL/RLS/dependências e private fora da DataAPI antes de qualquer aplicação isolada. Não executar db reset/push ou replay histórico.

## Aceite e dependências

Os27 gates locais são registrados no handoff com SHA/tree/log hashes: estática, pipeline, tipos/lint, regressões SQL/UI/transporte, datas em fuso adicional, quatro fixtures de navegador isoladas, build/bundle/artefato e coordenação. Fixtures não aprovam GoTrue/PostgREST, catálogo/RLS nativos, duas sessões MVCC, scanner/Hub/SSX real, CI hospedado ou apresentação completa da aplicação. Todos19 objetivos anteriores e novos casosF ficam pendentes de reteste do SHA combinado pelo revisor.

- A5: renomeação autorizada/recarga/auditoria única, stale CAS e concorrência2sessões, negativos de papel/tenant, ausência de acesso direto; advisors abrangendo private.
- F06: fluxo UI→RPC, centavos/limites/Number/JSON, origem bruta, replay/perda de resposta e duas sessões. F07: identidade viagem/carga/veículo distinta e mudança de contexto.
- F02/F08/F09/F10/F11: cache frio/quente/incompatível, revogação/reconexão/replay, detalhe aberto/refetch/removido/reatribuído, datas/foco/ARIA e severidades com Auth real.
- F05: gateway Deno/JWT e RPC nativos, credencial servidor/vínculo único/allowlist HTTPS exata, somenteGET documento existente, rebind/revogação após I/O, zero bytes nas negativas e download em navegador. Nova Edge instalada antes do frontend; nenhuma emissão fiscal de teste.
- F01 depende de plano físico/endereços/coordenadas aprovados, sem inventar dados. F03 depende de host/TLS/custo/configuração scanner e negativas reais, sem bypass. F04 continua exigindo escopo operacional próprio instalado e reteste. A13/amostra sanitizada exige fonte/destino/conteúdo concretos para QA já autorizada. SSX401 aguarda autenticação do usuário; sem comandos/configuração de veículos.
- Preview/CI já autorizado exige alvos e automações Supabase/Vercel revisados pela coordenação antes de push/deploy; emissor preview não é automaticamente sandbox. Rodadas fiscais locais não chamam provedor.

## Retorno e publicação

Rollback SQL A5 restaura42703; preferir voltar frontend mantendo forward compatível. Rollback de peso restaura aceitação antiga de casas adicionais, portanto exige pausa/backport da regra conforme decisão operacional. Ambos preservam dados/auditoria/replay e têm arquivos guardados próprios. F05 frontend antigo reabre indisponibilidade do download; não chamar isso de retorno funcional validado.

Somente após aceite nativo/CI completo no mesmo SHA e autorização final: incorporar pela fila, preparar commit de entrega isolado com mesma árvore, validar SHA final e publicar na ordem contratoSQL→Edge→frontend com preestado/rollback. Nenhum enqueue/integrate, push, deploy ou mudança de produção aconteceu nesta entrega.

## Integração: gate estrutural Cargo

O gate do primeiro SHA combinado 0af39a05 detectou DriverCargoCustody.tsx com 559 linhas, acima do limite crítico de 481. A entrega individual não tinha executado esse gate. O log reprovado e o commit anterior foram preservados. A extração dos cartões de apresentação para DriverCargoCustodyFields.tsx reduziu a página a 473 linhas e criou um componente com 245 linhas. Textos, IDs, labels, atributos e callbacks foram preservados; handlers controlados, estado, efeitos, queries, mutações, guards e replay permanecem na página. Nenhum limite do baseline foi aumentado. Os 90 testes das sete suites Cargo existentes, quality e lint passaram em Node 22 antes deste commit; os 27 gates repetem na nova árvore.

A aplicação inicialmente rejeitada pela revisão automática só ocorreu após autorização direta do usuário nesta sessão para os dois arquivos, QA/commit, testes locais isolados e duas notas do Vault. Nenhuma outra tentativa ou execução alternativa foi usada antes dessa autorização.

## Integração F05: dependências e contratos de teste

A primeira rodada de 116 suites em 8d665f14 registrou 1285 PASS e três falhas em dois arquivos. Uma fixture dependia da URL global do runner; a nova Edge não tinha o pin CORS padronizado e faltava no inventário fechado de service credentials. As demais verificações independentes foram concluídas, com a falha preservada. Após autorização específica, a integração acrescentou somente o pin @supabase/supabase-js/cors 2.108.2 à nova Edge, incluiu somente driver-fiscal-file no inventário e na exigência de verify_jwt=true e fixou/restaurou a URL .invalid da fixture de download com fetch mockado. Não removeu assertions, enfraqueceu inventário ou alterou handlers, CORS compartilhado, emissão, grants, SQL ou config.toml. As suites F05/config, lint e Edge syntax passaram antes do commit; os27 gates repetem no novo SHA. Pin ausente reprova o contrato do repositório, mas não foi demonstrada falha runtime de import por essa ausência.
