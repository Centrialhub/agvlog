# Reconciliação segura das coordenadas das paradas existentes

Leitura de produção realizada em 2026-09-02, sem mutações e sem chamadas a geocoding, SSX ou provedores fiscais.

## Resultado

As duas `dispatch_stops` existentes não podem ser geocodificadas automaticamente com evidência armazenada suficiente:

- ambas possuem `client_id = null`, `latitude = null` e `longitude = null`;
- os campos `clients.addresses` existentes são arrays vazios e não contêm coordenadas;
- não há POIs, geofences, waypoints ou `trip_routes` armazenados;
- não há `proof_of_delivery` nem `dispatch_events` com localização para essas paradas;
- não há `trip_stops` associados às duas viagens;
- a parada pendente `ROTA - JANUARIA` não possui histórico de posição para o veículo;
- a parada já marcada como chegada reúne várias cidades em um único destino textual. O histórico do veículo termina antes do horário da chegada e não há posição próxima que possa comprovar um ponto físico.

Um centroide de cidade, a última posição conhecida do veículo ou a coordenada de uma das cidades agregadas não representa necessariamente o ponto físico de entrega. Portanto, nenhum desses valores deve ser gravado como coordenada da parada.

## Plano operacional

1. Publicar primeiro o hardening aditivo que exige coordenadas explícitas para novas paradas em estado `planned`, `pending` ou `arriving`.
2. Manter temporariamente o overload legado `driver_mark_arrival(uuid)` enquanto existir parada ativa anterior ao hardening sem coordenadas.
3. Para a parada pendente, o operador deve confirmar o ponto físico correto e informar latitude/longitude verificadas. Se o texto representar várias entregas, deve replanejar em paradas físicas separadas; não usar um centroide.
4. Manter a parada histórica já chegada sem alteração automática. Ela não fornece evidência adequada para criar uma geofence retroativa.
5. Reexecutar a auditoria abaixo. O cutover do overload legado só pode ocorrer quando o total de paradas ativas pré-chegada sem coordenadas for zero e o frontend GPS estiver publicado e testado.

```sql
select id, dispatch_trip_id, destination, status, latitude, longitude
from public.dispatch_stops
where status in ('planned', 'pending', 'arriving')
  and (
    latitude is null or longitude is null
    or latitude not between -90 and 90
    or longitude not between -180 and 180
  )
order by created_at, id;
```

O hardening não altera as duas linhas antigas. Ele bloqueia somente novos inserts ou transições para estados pré-chegada sem um par válido, preservando atualizações de notas e a conclusão operacional das paradas legadas.
