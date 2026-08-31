# Ajustes auditados dos acertos — candidato local

Estado: implementado e verificado localmente; **não publicado**. Gate final aprovado: **2.360 testes/200 arquivos e 290 ensaios PostgreSQL nativos**, ambos encerrados com código zero. Não é liberação do aplicativo como pronto para produção.

## Defeitos reproduzidos

Sete testes executam as duas RPCs legadas extraídas do baseline com os builders financeiros reais da cadeia local:

- Adicionar ou remover um ajuste de acerto manual chama o builder de viagem com ID nulo e falha com `trip_not_found`; a transação reverte o item.
- Repetir a inclusão na viagem duplica o valor.
- Natureza nula, fração de centavo, motivo em branco e `NaN` são aceitos pelo contrato antigo.

## Correção

Migração CLI: `20260830233637_audit_driver_settlement_adjustments.sql`.

Fingerprints SHA256 desta candidata:

- Migração: `ff22d25b3e4e7d6999fe08db21df80b1e320f7ec2cc21d270283171cbe1dd175`.
- Contenção: `abcfc3c0aad64e032a3c30e7df95508b155666c535cac56ac08a3f042bc7dbaa`.
- Retomada: `ddeaf9b7a7e1ad8198cbb906ea094bfc6e64d9be36190cca2caf78412a22c91e`.

Migrações anteriores preservadas: criação de despesas `bdcf404396ed97340051f8c30a9d6ab21fde917b247066efb2ab8fd5818d91d7`; MFA `a7a3ac1bb45a09d79d864fd667f58104b758cebe9277690bbbc14f8673417dc7`.

- Contexto por empresa/ator/acerto e revisão das fontes financeiras. O comando exige o estado que a operação conferiu, motivo, natureza válida e valor inteiro positivo em centavos.
- Inclusão e remoção compartilham um pedido idempotente. Uma resposta perdida é recuperada com o mesmo corpo/chave; outra ação com a mesma chave é rejeitada.
- Membro ativo operator/admin/owner. Admin e owner exigem AAL2; autorização/MFA são novamente conferidas após esperar pela chave. Metadados editáveis do usuário não autorizam ajustes.
- Locks delimitados às fontes financeiras e linhas existentes. Não reutiliza guardas de replanejamento, que confundiriam uma viagem histórica com uma carga atualmente realocada. Escritores concorrentes recebem conflito, não um recálculo silencioso.
- Builder manual para acerto manual e builder de viagem para acerto de viagem. Reembolsos aprovados e pagamentos existentes são preservados. Não chama pagamento, transferência, emissão fiscal ou rastreamento.
- Ledger append-only guarda antes/depois, ator, motivo, item e confirmação. Remoção não apaga a evidência histórica. O acerto auditado não pode ser excluído por cascata.
- Wrappers públicos INVOKER; implementação privilegiada em schema privado, com autorização própria e ACL explícita. Helpers não são APIs públicas. As duas RPCs antigas ficam sem execução por papéis API; DML de itens pelo navegador é revogado.
- Valores legados inválidos exigem conciliação. A remoção explícita de um único item inválido é possível quando o conjunto restante pode ser recalculado; múltiplas inconsistências não são corrigidas implicitamente.

Na tela real `DriverSettlementDrawer`, a aba usa rótulos associados, tipo/descrição/motivo legíveis, conferência explícita e fila persistida por empresa/usuário. Troca de revisão e falha de contexto bloqueiam confirmação sem apagar o rascunho. A recuperação permanece acessível dentro da tela, inclusive quando sua consulta principal falha. O detalhe do acerto agora separa cache por empresa/ator e filtra as quatro consultas pelo tenant.

O frontend não estima um pagamento a partir de totais possivelmente desatualizados: informa crédito/débito e que as despesas serão recalculadas. Nenhum pagamento é executado pela ação.

## Contenção e publicação

1. Conferir dependências e fingerprints contra o destino. A migração exige os builders conhecidos e a camada de MFA de despesas; uma diferença bloqueia a instalação.
2. Publicar banco e frontend em janela coordenada: a migração corta as duas chamadas antigas, portanto o frontend antigo não pode permanecer como escritor ativo.
3. Executar testes autenticados de add/remove, reenvio, papel, tenant, MFA, concorrência e efeitos em despesas/acertos. Confirmar os consumidores reais, sem pagamento externo.
4. Se necessário, aplicar `SETTLEMENT-ADJUSTMENT-CONTAIN-2026-08-30.sql`. O script adquire exclusividade contra comandos ativos, verifica 18 funções/ACLs, políticas, constraints, trigger append-only e fronteira de escrita; suspende os novos escritores sem apagar dados.
5. Após corrigir a causa, `SETTLEMENT-ADJUSTMENT-RESUME-2026-08-30.sql` restaura apenas os novos escritores para authenticated. Acesso legado ou de serviço não é reaberto. Os scripts recusam alteração de contrato ou permissões.

## Evidência e limites

- Reproduções legadas: 7 aprovadas.
- Candidata SQL: 27 aprovadas, incluindo crédito/débito/remoção, replay após fechamento, reembolso manual, pagamento histórico sintético, MFA/tenant, valores inválidos, revisão e rollback tardio.
- Outbox: 8 aprovadas; tela integrada ao SQL: 11 aprovadas, incluindo recuperação com falha na consulta principal.
- Contenção/retomada: 6 aprovadas, incluindo rejeição de remoção de NOT NULL. Nenhuma proteção foi removida para obter aprovação.
- Regressões relacionadas de correção financeira e MFA de despesas: 30 aprovadas no ensaio conjunto.
- Gate amplo final: **2.360 testes/200 arquivos**, tipos, lint, qualidade, 41 sintaxes Edge, build e inspeção pública aprovados (código zero). São 59 testes novos neste bloco. Execução com dois workers, sem retirada de testes ou aumento de timeout. Testes em 347,26 s; build em 19,53 s; maior chunk 488,3 KiB e index 361,4 KiB. O gate anterior de 2.359 também passou, antes do teste adicional de NOT NULL.
- Suíte nativa final: **290 cenários aprovados** no PostgreSQL 17.11, incluindo os 281 anteriores e nove novos. Processo encerrado com código zero e cluster descartável parado. Snapshot dos módulos financeiros/operacionais preexistentes permaneceu idêntico; os novos dados de teste são sintéticos.
- Primeiro ensaio nativo: quatro cenários novos passaram; a fixture de fechamento falhou por falta de identidade no sincronizador financeiro (`forbidden`). O cluster foi parado. A repetição inclui a identidade do operador e mantém a guarda original intacta.
- Segundo ensaio: o fechamento passou; o fingerprint de constraints recusou o PostgreSQL 17 porque incluía as linhas NOT NULL do catálogo PostgreSQL 18. O PGlite foi identificado como 18.3. Agora há fingerprints separados para constraints relacionais e colunas (nome, tipo, nulabilidade e default), preservando a detecção de NOT NULL removido nos dois bancos. Referências: [catálogo PostgreSQL 17](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) e [catálogo PostgreSQL 18](https://www.postgresql.org/docs/18/catalog-pg-constraint.html).
- Advisor Supabase local: falhou em 127.0.0.1:54322 (`ECONNREFUSED`); Docker não localizado no PATH. Isso não é um resultado limpo de segurança.
- PostgreSQL portátil e PGlite não substituem a stack hospedada completa, testes reais de Auth/Storage/PostGIS nem E2E autenticado em navegador.
- Cobertura configurada: 93,03% de linhas/statements, 65,83% de branches, 81,81% de funções. É apenas o subconjunto configurado, não cobertura integral do aplicativo.
- Restam os demais escritores privilegiados, fluxo integral de aprovação/fechamento/pagamento, reconciliações históricas e publicação coordenada. Esta correção não comprova revisão das aproximadamente 140 funções ainda apontadas na auditoria anterior.
- Próxima revisão da listagem: `useDriverSettlements` e opções de filtro ainda usam cache sem ator; `DriverSettlements` não trata erro de consulta e o `AuthProvider` não limpa o QueryClient no logout. Isso requer reprodução de troca de sessão/revogação, além da proteção já aplicada ao detalhe; não se presume vazamento real sem o teste.
- Sem nova conexão de produção, pagamento real, emissão fiscal, scanner pago ou ativação SSX nesta etapa.

Skills: Supabase/Postgres orientaram privilégios mínimos, RLS, locks e verificação transacional. React orientou escopo do estado e armazenamento versionado mínimo, sem tokens ou arquivos persistidos na fila.
