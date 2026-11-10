# Log de release — Geoapify no geocodificador

## Identidade e estado

Responsável: Codex, pedido do usuário para conectar o projeto Geoapify criado
na conta da operação. Base `cacedbf8bee9b69001dcd8594f5557d5e834bb82`, branch
`codex/geocoding-geoapify-20261110`, checkout isolado em C:. Preparação; o PR e
artefato final registrarão SHA, gate e identidades publicadas.

## Estado anterior e retorno

- AGVLog Supabase `qcvnsdrbcchaxvawcngk`; ledger observado946/max20261110151444.
- Edge `geocode-address` v18, verify_jwt=false, autenticação própria preservada;
  bundle `fc9cf554e49f39a0163fcd7105d1ed1d18040fa851275ab78e641c342cfa6318`.
  Sete fontes recuperadas, comparadas por conteúdo LF e preservadas em
  `edge-source-snapshots-2026-11-10-geocode-v18/manifest.json`.
- Alias anterior cacedbf8, buildHashbe7e0ca4d680100a, backend correto AGVLog.
- Retorno de configuração: GEOCODING_PROVIDER=nominatim antes de qualquer
  restauração do bundle antigo. O serviço anterior apresentou falhas; retorno
  não comprova disponibilidade. Não misturar caches de provedores nem apagar
  coordenadas, auditoria, leases ou cooldowns. Conservar o frontend com atribuição
  Geoapify enquanto resultados desse provedor forem mostrados.

## Contrato

Novo adapter Geoapify apenas no servidor. Endpoint fixo HTTPS
`https://api.geoapify.com/v1/geocode/search`, filtro Brasil, idioma português,
limite5, timeout8s e redirects negados. Secret `GEOAPIFY_API_KEY` nunca no Git,
frontend, resposta ou logs. Erros de fetch/JSON podem conter URL com chave e são
substituídos por códigos fixos. Não transmitir XML, documentos fiscais ou nomes
dos usuários: somente o snapshot do endereço usado pelo fluxo existente.

GEOCODING_PROVIDER=geoapify é opt-in. Sem chave, falha fechada, sem fallback
inesperado. Mantém autenticação JWT/tenant ativo/membership ou cron existente,
hash/versão da entidade, namespaces tenant/provedor, cache, quota e ack da fila.
Não há SQL, RPC nova, mudança de RLS/Auth, quota ou bundle compartilhado.

Resultados estrangeiros, coordenadas inválidas e raízes malformadas não entram.
Só building com rua/número exatos, confiança global>=0,95 e níveis adicionais
confiáveis quando presentes pode receber quality=address_exact. Rua/cidade,
número divergente e baixa confiança continuam para revisão. accuracy_m é a
classificação operacional conservadora do aplicativo, não medição fornecida
pelo Geoapify. Não prometer resolução automática de todo endereço.

Crédito visível com links Geoapify e OpenStreetMap junto aos resultados, mapa,
paradas e despacho. Tiles continuam no fluxo atual; esta mudança integra busca
de endereços. Documentação consultada:
https://apidocs.geoapify.com/docs/geocoding/ e
https://www.geoapify.com/terms-and-conditions/ . O usuário criou a conta e aceitou
seus termos por conta própria. Não efetuar assinatura paga nem alterar cobrança.

## Validação e promoção

- Adapter: resultado realista, baixa confiança, rua/cidade/número errado,
  respostas inválidas, chaves ausentes, timeout, redirect e sanitização de erros.
- Handler real com transportes isolados: sessão/tenant/papel/quota, cache,
  ausência de gravação em erro e self-test privado. Não substitui teste SQL;
  nenhuma função SQL é alterada neste release.
- Private mode `geoapify_self_test`: exige a mesma autenticação cron, usa somente
  Praça da Sé, São Paulo (local público fixo), não aceita endereço do corpo e não
  grava cache, jobs ou operação. Não revela chave. Custa uma consulta do serviço.
- Deno check, typecheck, lint, sintaxe Edge, baseline, build e Quality completo:
  validate, oito shards e database-and-e2e no SHA candidato.
- Ordem: bundle geocoder reconciliado ainda sem ativação; frontend com créditos;
  chave configurada com segurança pelo usuário; self-test positivo; somente
  então GEOCODING_PROVIDER=geoapify e conferência de versões/alias/contratos.
  Não alterar apenas a URL do Nominatim para a API Geoapify: contratos diferentes.

## Evidências e pendências

Acesso ao projeto/área API Keys conferido sem ler/exibir a chave. A credencial
deve ser fornecida pelo usuário na interface de Secrets, não no chat. Os testes
locais usam somente fixtures; nenhuma viagem, entrega, mensagem ou emissão
fiscal real é criada. Gate hospedado, configuração, self-test e alias público
devem ser registrados no PR antes de declarar ativação. Leituras de canhoto
pendentes de créditos Lovable permanecem fora deste escopo.
