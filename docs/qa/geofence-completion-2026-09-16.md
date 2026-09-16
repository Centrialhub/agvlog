# Fechamento de geofence — 2026-09-16

## Resultado

O backend de geofence de entrega e de frota está ativo no projeto Supabase de produção
`qcvnsdrbcchaxvawcngk`. A implementação passou a tratar o endereço canônico verificado
como fonte de verdade e falha de forma segura quando a origem não representa um único
destinatário.

O frontend correspondente está implementado e validado localmente, mas ainda não foi
publicado: esta estação não possui vínculo `.vercel/project.json` nem sessão autenticada
no Vercel. A migração que remove totalmente a escrita direta legada de geofences permanece
deliberadamente não aplicada até que o frontend novo possa ser publicado na mesma janela.

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

Verificação feita em 2026-09-16 às 13:04 BRT:

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

No mesmo instante, o backlog de clientes continha 916 itens pendentes, 66 ambíguos e 22 com
erro; nenhum resultado abaixo do limiar foi promovido a endereço verificado. Esses números
são transitórios enquanto o cron continua processando a fila.

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
- advisors do Supabase após o endurecimento: nenhum aviso de segurança ou performance
  acionável novo para a implementação de geofence.

O advisor ainda lista como `INFO` a tabela interna `geocoding_provider_rate_limits` com RLS
e sem política. Isso é intencional: ela não é uma superfície do navegador e opera somente
por funções privilegiadas. Índices recém-criados também aparecem temporariamente como não
utilizados porque ainda não houve volume suficiente depois da criação.
