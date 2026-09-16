# Fechamento de geofence — 2026-09-16

## Resultado

O backend de geofence de entrega e de frota está ativo no projeto Supabase de produção
`qcvnsdrbcchaxvawcngk`. A implementação passou a tratar o endereço canônico verificado
como fonte de verdade e falha de forma segura quando a origem não representa um único
destinatário.

O frontend correspondente está implementado, validado localmente e publicado em preview
isolado a partir do commit `e88452de09056b1469c38984258b79b8b3110d67`. O artefato foi
inspecionado no navegador e está pronto para promoção. A produção ainda serve o frontend
anterior porque a promoção exige confirmação operacional. A migração que remove totalmente
a escrita direta legada de geofences permanece deliberadamente não aplicada até o frontend
novo ser promovido e verificado na mesma janela.

## Comportamento entregue

- O geofence de entrega usa somente `dispatch_stops.location_address` ou o endereço
  canônico verificado de um único cliente. O rótulo operacional `destination` nunca é
  geocodificado como endereço.
- Paradas agregadas que representam vários destinatários não recebem um geofence falso.
- A fila de resolução de endereços roda por cron a cada minuto, priorizando paradas de
  entrega e processando o backlog de clientes em lotes protegidos por lease.
- A resolução automática exige um único candidato, confiança mínima de `0.75` e precisão
  máxima de `250 m`; resultados de rua, CEP, bairro ou cidade permanecem para revisão.
- Geofences de frota da categoria cliente podem optar por `auto_sync_address`. Quando o
  endereço canônico do cliente muda ou é verificado, centro, geometria, provedor,
  confiança, precisão e auditoria são reprojetados automaticamente.
- A tela local de geofences permite selecionar o cliente, ativar a sincronização e mostra
  os estados `Aguardando endereço` e `Endereço sincronizado`.
- A RPC livre legada `upsert_geofence(...)` não é mais executável por `authenticated`;
  somente `service_role` mantém compatibilidade de recuperação interna.
- RLS ficou explícita e sem políticas permissivas sobrepostas. Durante a fase de expansão,
  membros leem e administradores ainda podem inserir, atualizar e excluir para manter o
  frontend antigo funcional. O frontend novo já usa `mutate_fleet_geofence_v1`; a migração
  de contração revoga essas escritas diretas depois da promoção.

## Evidência de produção

Verificação atualizada em 2026-09-16 às 14:41 BRT:

- cron `address-resolution-queue-every-minute`: ativo, agenda `* * * * *`;
- últimas cinco execuções observadas, entre 14:37 e 14:41 BRT: `succeeded`;
- Edge Function `geocode-address`: ativa, versão 9, hash
  `61f5bc5192944bcc353c31607ae83fd373d23507f92532c405714ebf312875f5`;
- chamada sem autenticação: HTTP `401 {"error":"unauthorized"}`;
- proteção contra uso de `destination` como endereço: presente;
- índices de FK/worker: presentes;
- RPC legada para `authenticated`: revogada;
- geofences existentes: 0; nenhum geofence incorreto foi criado.

O RPC canônico de frota foi exercitado no projeto de produção com o contexto real de um
administrador autenticado. O teste criou uma cerca temporária, desativou-a, repetiu a mesma
requisição e a excluiu. A repetição produziu exatamente uma linha no
`operator_command_ledger`, a exclusão produziu sua própria confirmação e a cerca temporária
deixou de existir. Permaneceram apenas as duas entradas de auditoria do teste.

O preview Vercel
`https://agvlogistica-p7lv5obua-centrialhubs-projects.vercel.app` está `Ready` e corresponde
ao commit `e88452de09056b1469c38984258b79b8b3110d67`. O `release.json` retornou HTTP 200,
`application/json` e `buildHash` `2ff4fa726deea02f`. O bundle
`Geofences-9agF0f3S.js` contém a sincronização automática, o estado `Aguardando endereço` e
o RPC `mutate_fleet_geofence_v1`, não contém exclusão direta e não gerou avisos ou erros no
console da tela de autenticação.

As duas paradas não terminais existentes são legadas e agregadas:

- `ROTA - JANUARIA`, status `pending`;
- rota multicípio, status `arrived`.

Ambas estão sem `client_id`, `location_address`, coordenadas ou endereço canônico. Por isso,
as duas entradas foram marcadas como `ignored` com a fonte ausente, em vez de fabricar uma
posição a partir do nome da rota. Elas precisam ser replanejadas em paradas por destinatário
ou receber um endereço de entrega explícito.

Às 14:41 BRT, o backlog de clientes continha 532 itens pendentes, 354 ambíguos e 118 com
erro; os dois itens de `dispatch_stop` continuavam corretamente como `ignored`. O aumento
das filas de revisão é esperado à medida que o worker classifica o backlog, e nenhum
resultado abaixo do limiar foi promovido a endereço verificado.

## Alterações principais

- `20260916152615_finalize_geofence_automation.sql`
- `20260916153316_prioritize_delivery_geofence_resolution.sql`
- `20260916153615_require_recipient_address_for_delivery_geofence.sql`
- `20260916154000_calibrate_geocoding_quality.sql`
- `20260916162000_harden_geofence_runtime.sql`
- `20260916162500_consolidate_geofence_rls.sql`
- `20260916165000_stage_canonical_fleet_geofence_commands.sql`
- `20260916170000_enforce_canonical_fleet_geofence_writes.sql` (contração pós-promoção)
- `supabase/functions/geocode-address/index.ts`
- `supabase/functions/_shared/geocoding-quality.ts`
- `src/components/geofences/GeofenceFormDialog.tsx`
- `src/components/maps/LocationPicker.tsx`
- `src/pages/Geofences.tsx`

## Validação

- pipeline `npm run check` do candidato mínimo: aprovado em checkout LF limpo
  (`637` arquivos de teste e `5.034` testes aprovados);
- cobertura do candidato mínimo: 93,52% statements/lines, 71,6% branches e 83,33%
  functions;
- lockfile, TypeScript, lint, baseline estrutural, 74 arquivos TypeScript de Edge
  Functions, build e inspeção de artefatos públicos: aprovados;
- testes focados de automação e qualidade de geocodificação: aprovados;
- advisors do Supabase após o endurecimento: nenhum aviso de segurança ou performance
  acionável novo para a implementação de geofence.

O advisor ainda lista como `INFO` a tabela interna `geocoding_provider_rate_limits` com RLS
e sem política. Isso é intencional: ela não é uma superfície do navegador e opera somente
por funções privilegiadas. Índices recém-criados também aparecem temporariamente como não
utilizados porque ainda não houve volume suficiente depois da criação.
