# Log de release — despacho e indisponibilidade de endereços

## Identidade e estado

Solicitação: prints do despacho com notas “Sem parada” após a atualização PR18.
Responsável: Codex; checkout isolado em C:, branch
`codex/dispatch-assignment-fix-20261110`, base
`e1413224c14fe0440a23f7e5344c69d6d1bc2988`. Preparação; evidência final no PR.
O usuário já autorizou Git/Vercel. Preservar os checkouts e serviços históricos.

## Estado anterior, evidência e hipótese

Alias Vercel anterior: e1413224, buildHash477e8237f8a8be55, backend AGVLog
`qcvnsdrbcchaxvawcngk`. Nenhuma migração/Edge nesta correção.
Na carga reportada: 74 itens/74 notas, 44 destinatários com endereço completo,
zero coordenadas verificadas e zero rascunhos de planejamento. Somente contagens
foram consultadas; nenhum despacho ou dado operacional criado.
Logs entre 15:50 e 16:40 UTC: geocode-address retornou 87 POST429 e 19 POST502,
sem POST200 no recorte. Esses eventos comprovam limite/indisponibilidade, não a
causa interna do provedor. A preparação anterior fazia três consultas paralelas,
descartava erros e só publicava paradas após terminar toda a busca; nesse intervalo
os seletores exibiam “Sem parada”. Não atribuir o defeito a cookies nem afirmar
que o provedor externo voltou a funcionar.

## Mudança e contrato

- Publicar a distribuição das notas antes da busca externa; criação da viagem
  continua bloqueada enquanto a preparação não terminar e pelos guards vigentes.
- Uma consulta por vez, no máximo 30/minuto nesta preparação, cache por endereço
  e interrupção em falha. Quotas globais e entre empresas continuam no servidor.
- Expor aviso do serviço indisponível/limitado, mantendo notas e endereços.
- Revisão de notas abre sob demanda com select nativo e contagem de vinculadas;
  não gerar remanejamento ao montar/atualizar, ignorar valores vazios/inválidos.
- Reutilizar a rua completa na confirmação do local. Não inventar coordenadas,
  destinos ou exceções operacionais; a distribuição não comprova a localização.
- Preservar escopo/cancelamento, sequência de rota salva, composição exata,
  RPC oficial de despacho e demais guards tenant/Auth/CAS/RLS/fiscal.

O provedor atual permanece dependência externa. A política do Nominatim público
limita a aplicação a uma consulta/segundo, com cache e restrições de uso:
https://operations.osmfoundation.org/policies/nominatim/ . Não substituir nem
ampliar serviços/provedores, transmitir dados a outro destino ou contornar quotas
neste delta. O usuário foi consultado sobre serviço de mapas já contratado.

## Validação e promoção

Testes com 74 notas/44 paradas, sem remanejamento ao montar, espera externa
controlada, todas as notas visíveis antes da resposta, falha com circuito fechado,
cancelamento durante pacing e preservação de composição. Testes de geocoding
distinguem429/502/503/504 sem transformar falha em endereço inexistente.
Exigir typecheck, lint, build, baseline e Quality completo do candidato.
Não despachar carga real como teste. Smoke autenticado anterior foi dispensado;
não descrevê-lo como realizado. Identidades Git/Vercel finais e resultados no PR.

## Retorno e pendências

Retorno: promover frontend e1413224; nenhum SQL/Edge para desfazer. Banco946 e
OCR v13 preservados; a leitura de canhotos continua pendente de créditos Lovable,
fora desta correção. Gatilhos: perda/duplicação de vínculo, escopo obsoleto ou
possibilidade de envio sem verificação exigida. Busca externa indisponível deve
continuar explicitamente pendente; esta publicação não aprova o provedor.
