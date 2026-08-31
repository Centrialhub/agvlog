# Correção auditada de entregas — candidata local

Estado: **implementada e validada localmente; não publicada.** Este lote não conclui reentrega nem a prontidão integral do app motorista.

## Contrato implementado

`20260830124944_add_operational_document_corrections.sql` adiciona `record_operation_document_correction(jsonb)`. A operação exige usuário ativo com papel owner/admin/operator no tenant, nota/parada/viagem coerentes, resultado anterior ainda atual, revisão esperada, motivo, horário real e chave idempotente. Entrega exige recebedor; parcial exige quantidades devolvidas válidas dos itens da própria nota, menores que o total.

A transação preserva o resultado original, acrescenta outro resultado imutável e uma relação explícita de correção. A projeção corrente exclui versões substituídas. A mesma nota pode ser corrigida novamente, sempre a partir da versão atual, sem criar ramificações. O histórico original não é apagado nem editado.

O comprovante anterior é aposentado sem perder ID/arquivo referenciado. Uma nova entrega/parcial cria outro comprovante manual **pendente**, não um arquivo fictício nem uma cópia do comprovante anterior. O portal mantém acesso ao histórico condicionado à autorização atual de download.

O resultado de parada/carga é reavaliado, mas horários físicos não são inventados. A viagem concluída mantém início/fim; a correção não reabre a viagem nem libera a nota para outra carga. Notas sem histórico auditado são recusadas e precisam de reconciliação específica.

## Interface, recuperação e financeiro

- `LoadNotesPanel` substitui `clearDeliveryStatus` por **Corrigir resultado**. O diálogo exige resultado, parada, horário e justificativa explícitos; mostra histórico atual/anterior e congela a revisão selecionada. Contexto obsoleto exige revisão e nova seleção, preservando a justificativa digitada.
- A fila guarda correções em envelope **v2**, no mesmo escopo tenant/ator/carga/nota. Versão incompatível ou payload corrompido não são migrados silenciosamente. Após resposta perdida, usa a mesma chave e payload, pela RPC de correção. Uma confirmação comum não aceita resposta de correção.
- Resposta incompleta, sessão trocada durante transporte ou contenção `55000` preservam a solicitação. Não há reenvio automático nem descarte da incerteza para liberar novo pedido. Nenhum token ou arquivo é persistido; motivo/recebedor necessários ao replay permanecem localmente até confirmação.
- Se já existe acerto, seus valores, itens, pagamentos, status e snapshot são preservados. A correção registra evento financeiro e marca `needs_recalculation=true`; não paga, não emite, não recalcula automaticamente e não sincroniza obrigações por conta própria.
- Banco e interface bloqueiam novo pagamento, quitação, aprovação e fechamento enquanto há revisão pendente. Reabertura explícita continua disponível. Diálogos de pagamento/quitação abertos antes da atualização também ficam bloqueados quando a nova informação chega.
- Foram adicionadas descrições acessíveis aos diálogos testados e associação de rótulos aos campos de valor/motivo tocados. Isso não equivale à auditoria Axe completa de despesas ou de todo o financeiro.

## Integridade e privilégios

O lock segue viagem/grafo antes do acerto; conflitos em acerto ou membership falham prontamente, sem aposentar parcialmente um comprovante. Membership é revalidada após espera pela chave de idempotência. Uma repetição antiga do motorista não sobrescreve o resultado corrigido.

Um constraint trigger diferido verifica o estado final da nota no commit: vínculo/tenant, status e metadados protegidos devem corresponder ao histórico corrente. Assim, o reset legado para `confirmed`, limpeza de metadados e troca direta de carga são recusados para resultados auditados. O trigger não substitui a futura modelagem de nova tentativa.

`delivery_document_corrections` tem RLS, SELECT apenas para operador ativo do tenant e nenhum DML para papéis API. A view corrente e os helpers não têm grants de API. O guard diferido é `SECURITY DEFINER` privado para ler toda a referência após a RPC retornar, independentemente da RLS do chamador; não retorna dados nem concede API de escrita. A RPC pública elevada exige autorização explícita. Essas escolhas seguem a revisão Supabase/PostgreSQL de [grants, RLS e views](https://supabase.com/docs/guides/database/postgres/row-level-security); a revisão React orientou isolamento de contexto e envelopes persistidos versionados.

## Testes e limites da evidência

- 35 testes SQL de correção/integridade/permissões, seis da tela operacional integrada ao SQL, sete da tela financeira com estado produzido pelo SQL e dez de contenção/restauração local. O caso financeiro com pagamento sintético de R$ 125 preserva valor, linha do pagamento e cópia no snapshot imutável, sem outra sincronização financeira.
- 18 novos testes de recuperação/contrato, além dos 14 anteriores no mesmo arquivo. Incluem corrupção, resposta incongruente, troca de sessão/tenant e preservação durante contenção.
- A primeira execução do gate parou em tipos dos testes novos; foram corrigidos import não utilizado, resultados SQL sem tipo e uma opção inválida da biblioteca de testes. Essa execução não é contada como aprovação.
- O primeiro ensaio nativo ampliado passou pelas disputas entre correção/motorista e pela contenção, mas falhou no próprio roteiro de restauração por faltar separador entre definições SQL. O script foi corrigido e o cluster encerrado antes da repetição. Essa execução também não é contada como suíte aprovada.
- Uma execução posterior passou 1.624/1.625 testes e revelou o cenário de UI que usava o relógio da execução, podendo ultrapassar o fim da viagem. A fixture passou a usar o horário do resultado registrado; acrescentou-se teste explícito da recusa após o encerramento, com motivo preservado e mensagem clara. A restrição de horário do backend não foi relaxada.
- **Ensaio nativo final: 166 casos aprovados**, 16 novos em relação ao lote de comprovantes. PostgreSQL 17.11 com Node 22.23.2, cluster descartável encerrado e processo finalizado com código zero. Inclui correção versus conclusão do motorista nos dois sentidos, idempotência, revisão obsoleta, membership revogada durante espera, bloqueio de acerto, integridade no commit, contenção e restauração adiante.
- **Gate geral final: 1.626 testes/140 arquivos aprovados**, processo encerrado com código zero, Node 22.23.2/npm 10.9.4. São 76 testes novos em relação aos 1.550 do lote de comprovantes. TypeScript, lint, baseline, sintaxe das 40 Edge Functions, build e scanner do artefato público passaram. Maior chunk: 488,3 KiB, limite 500 KiB.
- Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções. Não é cobertura integral do aplicativo nem comprovação de prontidão de produção. O scanner não identificou source maps ou padrões de segredos reconhecidos; não constitui auditoria irrestrita de segredos.

Fixtures usam baseline já versionada, SQL real e dados sintéticos em PGlite/PostgreSQL local. Os hooks de leitura financeira recebem dados SQL, mas mutações financeiras de UI são interceptadas nos testes; a recusa de pagamento/fechamento é verificada separadamente no banco. Não se afirma E2E financeiro hospedado.

Não houve conexão de produção, emissão fiscal, transferência financeira, reativação SSX, serviço adicional ou deploy neste lote. Não houve novo dump de funções/schema de produção. PostgreSQL mínimo não substitui Supabase completo com Auth, RLS integrada, Storage, PostGIS e navegador autenticado.

## Contenção e publicação

[OPERATION-CORRECTION-CONTAINMENT-2026-08-30.sql](OPERATION-CORRECTION-CONTAINMENT-2026-08-30.sql) confere oito funções/ACLs, cinco triggers e condições de RLS/DML antes de suspender as três APIs de baixa/correção. Recusa divergência/reaplicação. Não remove nenhum registro de negócio e mantém leitores, histórico, versões e a indicação de revisão financeira.

**Pré-condição operacional:** suspender novos envios e drenar chamadas já iniciadas. A substituição da função não cancela execuções anteriores. O script não implementa drenagem HTTP nem constitui autorização para execução desassistida em produção. A restauração ensaiada é adiante, com os mesmos escritores cientes de correções, seguida de replay da chave original. Contenções/recuperações anteriores recusam esses contratos novos; não remover seus guards.

Hashes locais normalizados: correção `be885bd42fe5a3a6b97840d97d571173`; confirmação operacional `bc9c55ae4aeea3a7fe53227ba34cbf30`; motorista `c3ce3d1b62954f5fc4d91567ad51f477`.

O lote depende das candidatas anteriores de carga/viagem, composição, preparação, baixa por nota e versionamento de comprovantes. **Não aplicar esta migração isoladamente nem publicar a árvore local inteira.** Manter a restrição de custo, verificar contratos publicados, ensaiar o conjunto completo, preparar publicação coordenada e repetir frontend/backend após cada aplicação.

## Próximo lote obrigatório

Atualização: a [fundação privada de tentativas](TENTATIVAS-ENTREGA-2026-08-30.md) foi acrescentada e validada localmente, com ativação explicitamente fechada. Ela preserva os contratos desta correção; não substitui a reentrega completa exigida abaixo.

1. Modelar **reentrega como nova tentativa/alocação**, separando vínculos ativos e históricos. Uma correção não é uma nova viagem. Preservar projeções e acertos antigos e evitar dupla contagem.
2. Substituir `confirmRedelivery`, autosave/detecção de pagamento e `saveAll` por escritores específicos, condicionais e recuperáveis. O guard evita gravação incompatível, mas esses handlers antigos ainda podem falhar e não estão concluídos.
3. Proteger arquivos atuais/históricos no Storage: autoria/posse de upload, referências e disputa entre vinculação/limpeza. O `cleanup` atual aceita caminho do mesmo tenant sem verificar referência; DELETE direto legado precisa de revisão. Imutabilidade de linha SQL não prova preservação do arquivo.
4. Concluir fila durável do motorista, GPS/PostGIS/exceções auditadas, jornada concorrente, despesas/Axe, comunicações/anexos, convites/Auth hospedado, revisão individual de funções e ambiente fiscal seguro. Manter SSX inativo.
5. Ensaiar corrigir → nova tentativa → despachar → entregar → portal → acerto, incluindo falhas, concorrência e dois tenants, e executar E2E autenticado. `.env.test.local` não está disponível nesta etapa; há trabalho local útil antes disso.

Todas as cargas atuais estão autorizadas para testes; alterações em produção continuam condicionadas a **nenhum gasto extra**. A meta permanece ativa e não foi declarada 100% concluída.
