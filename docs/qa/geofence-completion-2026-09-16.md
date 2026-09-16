# Fechamento de geofence — 2026-09-16

## Resultado

O backend de geofence de entrega e de frota está ativo no projeto Supabase de produção
`qcvnsdrbcchaxvawcngk`. A implementação passou a tratar o endereço canônico verificado
como fonte de verdade e falha de forma segura quando a origem não representa um único
destinatário.

O frontend correspondente está implementado e validado localmente e foi publicado em uma
prévia protegida do Vercel a partir do commit `1e2e6721`. O artefato hospedado foi inspecionado
com a sessão autenticada do navegador e contém a sincronização automática, o estado
`Aguardando endereço` e a mutação canônica de frota; não contém exclusão direta de geofence.

A produção ainda serve o frontend antigo. Por isso, a migração que remove totalmente a escrita
direta legada de geofences permanece deliberadamente não aplicada até a promoção coordenada
do frontend novo. Aplicá-la antes dessa promoção interromperia as operações de ativação e
exclusão da tela atual.

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
- RLS ficou explícita e sem políticas permissivas sobrepostas: membros leem; administradores
  inserem, atualizam e excluem.

## Evidência de produção

Verificação final feita em 2026-09-16 às 13:35 BRT:

- cron `address-resolution-queue-every-minute`: ativo, agenda `* * * * *`;
- últimas cinco execuções observadas: `succeeded`;
- Edge Function `geocode-address`: ativa, versão 9, hash
  `61f5bc5192944bcc353c31607ae83fd373d23507f92532c405714ebf312875f5`;
- chamada sem autenticação: HTTP `401 {"error":"unauthorized"}`;
- proteção contra uso de `destination` como endereço: presente;
- índices de FK/worker: presentes;
- RPC legada para `authenticated`: revogada;
- geofences existentes: 0; nenhum geofence incorreto foi criado.

As duas paradas não terminais existentes são legadas e agregadas:

- `ROTA - JANUARIA`, status `pending`;
- rota multicípio, status `arrived`.

Ambas estão sem `client_id`, `location_address`, coordenadas ou endereço canônico. Por isso,
as duas entradas foram marcadas como `ignored` com a fonte ausente, em vez de fabricar uma
posição a partir do nome da rota. Elas precisam ser replanejadas em paradas por destinatário
ou receber um endereço de entrega explícito.

No mesmo instante, o backlog de clientes continha 798 itens pendentes, 154 ambíguos e 52 com
erro. A queda de 916 para 798 pendências confirma que o worker está drenando a fila; o aumento
de itens ambíguos/erro é a classificação segura dos registros processados, sem promover
resultados abaixo do limiar a endereço verificado.

## Prévia publicada e gate de produção

- prévia protegida: `https://agvlogistica-quyrnn7jd-centrialhubs-projects.vercel.app`;
- commit implantado: `1e2e6721d3888772e6411cf1ff52b8d0b1de8e93`;
- bundle hospedado de geofence: HTTP 200, JavaScript, 28.025 bytes;
- evidências no bundle: `Sincronizar endereço automaticamente`, `Aguardando endereço` e
  `mutate_fleet_geofence_v1` presentes; `.delete()` ausente;
- página de autenticação carregada sem erros ou avisos no console;
- produção `https://agvlogistica.vercel.app`: bundle antigo, sem os estados acima, sem a RPC
  canônica e ainda com exclusão direta.

A promoção de produção continua bloqueada por dois gates objetivos do repositório: o candidato
limpo não inclui correções TypeScript/Vitest não relacionadas que permanecem apenas no enorme
worktree sujo, e a configuração de metadados `release.json` também está nesse conjunto não
consolidado. O build de produção e os 17 testes focados de geofence do candidato passam, mas
promover sem fechar esses gates violaria o runbook de release e removeria a compatibilidade com
a tela atualmente publicada.

## Alterações principais

- `20260916152615_finalize_geofence_automation.sql`
- `20260916153316_prioritize_delivery_geofence_resolution.sql`
- `20260916153615_require_recipient_address_for_delivery_geofence.sql`
- `20260916154000_calibrate_geocoding_quality.sql`
- `20260916162000_harden_geofence_runtime.sql`
- `20260916162500_consolidate_geofence_rls.sql`
- `supabase/functions/geocode-address/index.ts`
- `supabase/functions/_shared/geocoding-quality.ts`
- `src/components/geofences/GeofenceFormDialog.tsx`
- `src/components/maps/LocationPicker.tsx`
- `src/pages/Geofences.tsx`

## Validação

- pipeline `npm run check`: aprovado no estado final (`895` arquivos de teste,
  `6.040` testes aprovados e `1` arquivo/teste ignorado);
- contrato Supabase: 455 migrações ordenadas e 47 Edge Functions;
- testes focados de automação e qualidade de geocodificação: aprovados;
- TypeScript, lint, sintaxe das Edge Functions, cobertura e build: aprovados
  (88,2% statements; 75% branches; 93,93% functions; 91,3% lines);
- candidato de prévia em checkout limpo: `npm ci`, build de produção e 17 testes focados
  aprovados; o typecheck completo expôs somente incompatibilidades Vitest 4 em testes alheios
  ao geofence que já estão corrigidas, porém ainda não consolidadas no histórico publicável;
- advisors do Supabase após o endurecimento: nenhum aviso de segurança ou performance
  acionável novo para a implementação de geofence.

O advisor ainda lista como `INFO` a tabela interna `geocoding_provider_rate_limits` com RLS
e sem política. Isso é intencional: ela não é uma superfície do navegador e opera somente
por funções privilegiadas. Índices recém-criados também aparecem temporariamente como não
utilizados porque ainda não houve volume suficiente depois da criação.
