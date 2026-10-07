# Log de correção dos bloqueadores M2/M3/A5 - 05/10/2026

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Autor / revisor SQL e fluxo | CodexMerge / revisor da réplica reservado separadamente |
| Tarefa | candidate-submit-20261005, F:/AGVLOG/work/candidate-submit-20261005 |
| Fonte congelada | 05d6639cf625deb851fbb5657ecef432d9c5a1a5, árvore 75e7e619df42c6f76f5a708fa34863de4f18ed8c |
| Estado | Correção local; homologaçao completa pendente; nenhuma publicação |
| SHA/árvore finais, hashes, horários e logs | Handoff imutável externo criado após commit e gates; não usar resultados de outro SHA |
| Fixtures | PGlite em memória; scaffold PostgreSQL cria cluster exclusivo novo em loopback com credencial descartável, sem URLs de aplicação ou download |
| Backend do build local | https://unit-tests.supabase.invalid, somente artefato QA; não publicável |

## Defeito e contrato

O checkpoint nativo do revisor em 05d6639c reprovou M2/M3 por PGRST201 e A5 por CHECK de saldo. Havia 18 critérios, zero linhas completamente aprovadas, três falhas e quinze pendências. Os 7529 unitários aprovados naquela versão não aprovaram esses fluxos. Os resultados nativos parciais de M4/A4/A8 permanecem históricos e exigem reavaliação do candidato novo.

M2/M3: a segunda FK composta fiscal_documents_load_tenant_fkey torna ambíguo loads(...). Cinco consumidores usam agora loads!fiscal_documents_load_id_fkey(...), sem alias, inner join ou alteração de filtros/projeção/forma nullable: NewLoadDialog, LoadItemsPanel, useBillingDocuments, useFiscalDocuments e Traceability. Ambas as FKs permanecem. O teste usa supabase-js e transporte sintético; PostgREST/Auth/RLS reais continuam gates do revisor. O caso de 505 notas exige os mesmos 503 IDs elegíveis, com controle de primeira vinculação emitida permitida e nota já operada excluída.

A5: o predecessor nativo de update_inventory_balance(), também presente no original preservado, tem MD5 b0ff5c10a960fc655a62032273b645f0. Um INSERT com delta negativo é rejeitado por CHECK antes de ON CONFLICT. O forward incremental 20261005190000 atualiza somente a linha encontrada e bloqueada por SELECT FOR UPDATE para saída; mantém o UPSERT positivo para entrada. Quantity, paletes, peso, volume e last_movement_at são atualizados; first_inbound_at, história, RPC/idempotência e validações de referência por tenant permanecem.

O guard de ajuste agora rejeita direção NULL: a lógica SQL anterior aceitava NULL e o novo UPDATE habilitaria um decrease inválido. Não amplia tipos nem altera restrições. Peso e volume nullable preservam semântica herdada; não há saneamento de dados ou coalesce sobre saldo existente.

## Banco e preservação

O forward exige o corpo capturado, PL/pgSQL trigger volatile/SECURITY DEFINER/search_path vazio, EXECUTE somente proprietário/service_role, chave UNIQUE NULLS NOT DISTINCT e CHECK de todas dimensões. Exige triggers habilitados incondicionais, sem argumentos, e hash do histórico imutável. Drift ou reaplicação falham fechados. Usa pg_get_functiondef e substituições únicas restritas; compara integralmente pg_proc menos prosrc, constraints, triggers e políticas antes/depois. Nenhum objeto, grant, RLS, trigger ou constraint é criado, removido ou enfraquecido pelo forward.

Manifesto original de 13 forwards permanece intacto. Os oito suplementos anteriores, incluindo motorista SHA256 7920eba717a1b1682a1dbf3966eefb74ba21e9ce9e7ff0557db3b49346b21f7a, são preservados; estoque é o nono suplemento com hash próprio. O lote exige baseline revisado e aplicação transacional; não executar replay histórico ou db push para contornar fingerprint divergente. A normalização de 21/09 difere do contrato nativo capturado e não foi aceita como predecessor alternativo.

## Evidência e gates

Em 2026-10-05 19:05 UTC, o smoke em memória reproduziu o erro original 23514/inventory_balances_dimensions_nonnegative com estado integralmente preservado; executou o forward completo e conferiu saldo 7/1/14/0,7 após IN10/2/20/1 e OUT3/1/6/0,3, preservando first_inbound e atualizando last_movement.

Em 19:08–19:09 UTC, 48 regressões HTTP/UI de joins e 16 regressões SQL passaram no draft. Estas últimas executam predecessor/RPC/imutabilidade/helper administrativo reais e constraints capturadas, cobrindo saldo, todas insuficiências, retry após ausência, replay/conflito, ajuste increase/decrease/NULL/inválido, refs de outro tenant, ator/tenant/RLS, histórico, OID/ACL/owner e drift de função/triggers. Não comprovam Auth hospedado nem concorrência real. Gates do SHA comprometido serão registrados no handoff, sem reutilizar aprovação do draft.

O novo scripts/test-inventory-outbound-native.mjs tem scaffold válido que não usa o runner antigo truncado; exige binários confiáveis PG17 existentes e lança/encerra apenas seu próprio cluster. O módulo executa nove conjuntos sequenciais e sete conjuntos de concorrência com pg_blocking_pids: request duplicado/conflitante, duas entradas em chave ausente, IN/OUT em saldo existente, saídas concorrentes insuficientes, OUT durante primeira IN não commitada + retry, revogação enquanto aguarda request lock e OUT duplicado. Não foram executados aqui por ausência de binários. Não contam como PASS, skip ou aceite.

## Próximos aceites do revisor

1. Receber SHA/árvore novos e manter 05d6639c/original preservados. Aplicar somente o nono suplemento na réplica exclusiva como proprietário autorizado, conferindo catálogo e hash antes/depois; nunca alterar fixture para mascarar CHECK.
2. Reexecutar M2/M3 com mais de 500 notas, IDs efetivamente persistidos, datas/fuso/seleções e negativos; reexecutar os cinco consumidores reais mantendo loads|null e isolamento.
3. Executar OUT válido/insuficiente, sete cenários concorrentes, replay/conflito, histórico, tenant/RLS e efeitos/timestamps. Complementar PGlite com o contrato nativo completo e UI A5/CAS/rotas/produtividade.
4. Reexecutar todos os 18 critérios e gates extensivos da árvore nova, incluindo integrações, scanner, fiscal homologação, SSX, SMTP e pagamentos elegíveis. Dependências indisponíveis continuam pendentes. Nenhum aceite integral é declarado por este log.

## Estado anterior e retorno

Nenhuma réplica, original, checkout servido, frente de frete, produção, configuração ou dado externo foi alterado por esta tarefa. Não há enqueue/integrate/commit final de entrega ou autorização de publicação neste checkpoint. Commits anteriores e suas árvores permanecem preservados.

Os formatos persistidos não mudam: fatos append-only, IDs, request hashes e saldos permanecem compatíveis. Retorno de frontend deve conservar os qualificadores FK para não reintroduzir PGRST201. Repor o trigger antigo reintroduz o defeito de OUT e não é retorno aprovado. O revisor deve ensaiar retorno com snapshot e escrita suspensa no isolado; avaliar manter a correção SQL durante retorno de frontend. Não excluir movimentos nem recalcular/apagar saldos para simular rollback.

Publicação e retorno operacional continuam dependentes de aceite nativo completo, identidade das quatro camadas, CI hospedado, backups, ensaio de retorno e autorização explícita posterior.
