# Peso da custódia: contrato servidor de duas casas em kg

Tarefa `driver-cargo-weight-server-20261006`, owner `CodexCargoServer`, checkout próprio `F:/AGVLOG/work/driver-cargo-weight-server-20261006`. Fork-review sobre `61adbbb997667396541244da147b224defb22e94`, tree-base `328f33f69c352720574b24deebaa9d19bde7faaf`, integração registrada `deda6fd1fa765648f8de1785a1a7693081ad11bb`. A fonte61ad permanece congelada. Banco/réplica e homologação nativa pertencem exclusivamente ao revisor `01a0f93e-da7e-72ca-9d2b-7d726233b026`.

Decisão explícita do usuário: **duas casas em kg**. A frente frontend CodexCargo implementa F06/F07 separadamente; sua nota `F:/Vault/Main Vault/05 Sessoes/Correção AGVLOG/2026-10-06-Codex-F06-F07-implementacao.md` define `String(Number)`→decimal/BigInt half-up, aviso bruto→normalizado e rejeição de entrada manual com terceira casa. Este delta não duplica nem modifica frontend.

## Contrato

1. Uma **nova** confirmação manual usa JSON numérico finito, não negativo, com valor exato em centésimos. `1`, `1.2`, `1.23` e zeros finais semanticamente equivalentes são aceitos; `1.005` e `7691.72607421875` são recusados com `trip_cargo_weight_precision_required`. Não arredondar silenciosamente o valor informado pelo motorista. O limite de centavos é `Number.MAX_SAFE_INTEGER=9007199254740991`, já usado no contrato frontend; inválido/inseguro é recusado. Também exige ida/volta decimal → Number → decimal sem perder o valor manual: 90071992547409.90 é aceito; .91 é recusado mesmo quando enviado diretamente em JSON numérico, pois perderia um centavo. A origem esperada não finita ou fora dessa representação é recusada antes do efeito.
2. A origem histórica/canônica permanece **bruta** em `loads.total_weight_kg` e no snapshot `trip_cargo_load_checks.expected_weight_kg`. Não há UPDATE de histórico, typmod/constraint que arredonde linhas antigas, normalização em massa ou mudança fiscal.
3. Para a comparação de novas confirmações, o esperado segue a representação recebida pelo frontend: conversão binary64 para representação decimal curta, seguida de `round(numeric,2)` decimal half-up para valores não negativos. O arredondamento não é feito em double precision. Por exemplo, `7691.72607421875→7691.73`, `1.005→1.01`, `2.675→2.68`, `9.995→10.00`, `1e-7→0.00`.
4. Há uma borda de serialização importante: `numeric '1.00499999999999999'` chega ao consumidor Number como `1.005`; o esperado operacional deve ser `1.01`, conservando o bruto mais preciso. O servidor usa `extra_float_digits=3` **somente na configuração da função** para estabilizar a representação curta, independentemente do GUC do chamador. O GUC do chamador é restaurado ao sair. Underflow positivo da conversão para binary64 equivale a Number0 e é tratado como0; overflow/NaN/Infinity são recusados.
5. Confirmado é persistido como `round(v_weight,2)` depois de comprovar que o valor já é centesimal. O limiar preexistente de divergência continua **estritamente maior que1kg**, aplicado ao esperado normalizado. Com esperado bruto1.005, confirmar2.01 representa diferença1.00 e não gera divergência;2.02 gera. `expected_value` da divergência continua conservando o esperado bruto para rastreabilidade.
6. A auditoria da confirmação inclui `weight_precision` com unidade,2casas, `decimal_half_up` e, por carga, `expected_raw_kg`, `expected_received_decimal_kg`, `expected_rounded_kg`, `confirmed_input_kg`, `confirmed_kg` e flag de arredondamento. Os valores de rastreabilidade são strings decimais para não perder dígitos no JSON de leitura. O ACK público/result do comando conserva seu formato anterior.
7. Hash/idempotência continuam vinculados ao payload **original**. Não reescrever `_payload` para fazer payloads diferentes parecerem iguais. Replay da mesma confirmação retorna o resultado armazenado sem novo efeito/auditoria; payload alterado sob mesmo UUID conflita. Replay de comando histórico já confirmado com mais casas permanece recuperável, com dados antigos intactos. A nova regra aplica-se às novas confirmações, não à reescrita do histórico.

## Delta fechado e guardas

- Migration criada pela CLI Supabase fixada2.116.0, após ler `migration new --help`: `supabase/migrations/20261006131127_enforce_driver_trip_cargo_weight_precision.sql`. A reserva do caminho exato precedeu a edição do SQL.
- Altera somente corpo/configuração de `private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)`. Proconfig adicional intencional: `extra_float_digits=3`; `search_path=''` preservado. O wrapper público de lacres, identidade do ator, advisory lock, tenant/driver ativo, estado, documentos, pallets/volumes, fotos, lacres, request/hash e atomicidade continuam no grafo real do predecessor.
- Preflight exige assinatura, tipo jsonb, linguagem plpgsql, SECURITY DEFINER, owner postgres, config revisada, ausência de EXECUTE para anon/authenticated/service_role no helper, ACL do wrapper e hashes exatos de helper/ator/wrapper. Corpo desconhecido, grant/config divergente ou predecessor parcial abortam; não se amplia whitelist.
- Pós-condição confere OID, owner, ACL, corpo e config deliberada. Reaplicação do suplemento é idempotente apenas no estado final exatamente reconhecido.
- Os26 forwards/manifests anteriores, migrations históricas, AGENTS herdado e arquivos de outras frentes não foram editados. O manifesto suplementar desta tarefa é separado: integração decide sua incorporação ao candidato combinado, sem sobrepor manifesto comum em paralelo.

Hashes de corpos SQL revisados (`md5(prosrc)`): predecessor `b3d9ae1864f6e7cbf4fae8c4d6df7d80`; pós-correção `c1680fb132f7940e998c2078eb2defb5`; wrapper público de lacres `54f27bd013f36ac7e1558cd783ffa3d1`; require-actor `2e5d786ae5ed1c66d0581dbcde858bde`. Revisor deve comparar o catálogo nativo antes de adotar; correspondência da fonte não prova correspondência do alvo.

## Testes e evidência

Teste próprio `src/test/driverTripCargoWeightDatabase.test.ts`, fixture `src/test/helpers/tripCargoWeightPrecisionDatabase.ts`. A fixture executa migrations reais de custódia, integridade e ciclo de lacres; Auth/tenant settings, schema dependente e audit sink são sintéticos, seguindo a fixture anterior. Não substitui a RPC de produto por mock nem se limita a buscar trechos de SQL. Cada caso chama o wrapper como authenticated e confere comandos/checks/documentos/auditoria/divergências persistidos.

Cobertura: os casos equivalentes da frente frontend, origem auditada, inteiro/zero/duas casas/empates/virada decimal/subnormal/underflow, borda de serialização Number, GUC adverso com restauração, negativos/tipos inválidos/overflow, revogação/tenant/ator, helper/anon negados, carga alheia, segunda carga inválida após primeira válida com rollback integral, photos/seals/pallets preservados, replay/payload conflict, dado histórico sem backfill, upgrade/replay/rollback/re-upgrade, dado novo/auditoria sobrevivendo retorno, drift de corpo/ACL/dependência e rollback recusado após alteração posterior.

Os logs e manifestos de execução final são externos ao checkout e fixados no handoff com SHA/tree. As rodadas de desenvolvimento anteriores ficam preservadas; não são herdadas como resultado do commit final. Tipo/lint direcionados usam os mesmos compilerOptions/regras de projeto. Nenhum gate amplo, GoTrue/PostgREST/Edge/Storage ou concorrência nativa foi executado por esta frente. PGlite é PostgreSQL em memória com SQL real, mas serializa sua conexão e não prova duas sessões nativas disputando o comando. Os90 testes locais do frontend não são evidência servidor.

Reprodução no worktree autorizado com dependências próprias do lockfile, Node22/npm10:

```powershell
node F:/AGVLOG/agvlog.mjs check --task driver-cargo-weight-server-20261006 --owner CodexCargoServer --cwd F:/AGVLOG/work/driver-cargo-weight-server-20261006 --operation test
npx vitest run src/test/driverTripCargoWeightDatabase.test.ts --maxWorkers 1 --testTimeout 30000
npx eslint src/test/driverTripCargoWeightDatabase.test.ts src/test/helpers/tripCargoWeightPrecisionDatabase.ts --max-warnings 0
```

O executor desta frente usou dependências existentes **somente para leitura** e config temporária própria, sem instalar/linkar node_modules na fonte protegida. Não iniciar Supabase/Docker/serviços compartilhados para reproduzir a fixture.

## Aceite nativo e retorno

1. Revisor recebe SHA/tree/base, bundle/delta, suplemento/rollback e hashes; confere catálogo/RLS/grants/tenant/ator/trigger graph no alvo descartável próprio. Drift interrompe adoção. Uma árvore combinada nova exige sua própria evidência, incluindo delta frontend F06/F07.
2. Aplicar somente o forward revisado em cópia descartável coordenada, com transação externa, lock_timeout/statement_timeout definidos pelo executor; não alterar timeouts de serviços compartilhados. Fonte/réplica ativa e dados produtivos permanecem preservados.
3. Via sessão nativa de driver, confirmar7691.73 a partir da origem bruta7691.72607421875; ler confirmado, origem/snapshot e auditoria. Repetir cases half-up/Number, negar terceira casa e actor/tenant/revogação, validar documentos/veículo/fotos/lacres e replay após perda de resposta. Duas sessões reais com mesmo UUID e payload divergente devem produzir resultado compatível/um efeito ou conflito, sem sucesso parcial. Não desligar guard para preparar dados.
4. Ensaiar `docs/qa/driver-cargo-weight-server-rollback-2026-10-06.sql` somente em clone autorizado. O rollback é incremental e guardado: restaura corpo/config do predecessor exato, sem UPDATE de dados, remoção de auditoria, perda de comando ou privilégio novo. Reaplicação/re-upgrade verificam o mesmo contrato.
5. Limite deliberado: retorno ao predecessor reabre aceitação de novas confirmações com mais casas e volta à comparação antiga do esperado bruto. Não descrevê-lo como manutenção do novo contrato; bloquear novas confirmações na janela ou conservar/backportar o novo contrato conforme decisão operacional antes de promoção. Dados/ACKs já confirmados e seus replays continuam compatíveis. Retorno frontend isolado não reverte este SQL.

Não houve aplicação na réplica, produção, push/deploy/enqueue/integrate nem commit final de release. O commit próprio congelado é uma unidade de correção para integração coordenada; aprovação dos19 objetivos, gate final combinado e publicação continuam separados.

## Referências consultadas

AGENTS e README AGVLOG; roteiro/log de estabilidade e proposta de baseline26/09; migrations reais de custódia/integridade/lacres; fixture `tripCargoCustodyDatabase.test.ts`; nota e helper frontend CodexCargo consultados só para leitura. Skill Supabase aplicada; changelog público consultado antes de implementar, sem upgrade de dependências.

As propriedades de arredondamento decimal e configuração de saída usadas aqui constam da documentação primária: [PostgreSQL17 — funções matemáticas](https://www.postgresql.org/docs/17/functions-math.html) e [tipos numéricos/extra_float_digits](https://www.postgresql.org/docs/17/datatype-numeric.html), consultadas em06/10/2026. Fronteiras de segurança preservadas conforme [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Changelog: [Supabase](https://supabase.com/changelog).
