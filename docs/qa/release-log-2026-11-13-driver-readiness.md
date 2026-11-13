# Log de release — boas-vindas e checklist do motorista

## Identidade e estado

- Responsável: Codex; autorização do usuário para checkout isolado em C: e publicação após testes. Política confirmada: “Registrar e permitir continuar”.
- Base: `ade31c25828a491fde8a7d7a79d5a1b175334a67`; checkout `AGV MOTORISTA ENTRADA`, branch `codex/driver-entry-checklist-20261113`.
- Alvo: AGVLog, Supabase `qcvnsdrbcchaxvawcngk`, alias `https://agvlogistica.vercel.app`. Preflight inicial: 949 migrations, última `20261113134817`; frontend base com buildHash `2ac4d9670e86b033`.
- Estado deste registro: candidato preparado; SHA, CI, versão SQL e alias finais serão registrados no PR após verificação. Este arquivo não afirma publicação antecipada.
- Fixtures exclusivamente sintéticas e isoladas. Nenhuma viagem real, baixa real, mensagem, emissão fiscal ou comando veicular utilizado como teste.

## Problema, contrato e riscos

O motorista precisava navegar e salvar manualmente o checklist. A entrada de uma viagem própria agora abre boas-vindas e seis perguntas, uma por vez: água, óleo, luzes, combustível, pneus e partida. A sexta resposta grava antes de abrir a carga. “Precisa de atenção” persiste como resposta negativa e não impede continuar. Isso não declara o veículo aprovado e não dá partida nem inicia jornada automaticamente.

O modelo `vehicle_readiness_v1`, schema 2, exige seis respostas booleanas e seis índices únicos. O servidor calcula `has_vehicle_issues`; índices significam perguntas respondidas, nunca seis aprovações inventadas. Checklists antigos de oito itens continuam válidos. Pós-viagem mantém cinco itens, fluxo de custódia/provas e autorização permanecem preservados. Entrada compartilhada entre empresas conserva a seleção explícita existente; dados obsoletos ou revogados continuam bloqueados.

Não há novas tabelas, RPCs públicas, dependências, Secrets ou Edge Functions. O helper privado não tem grant para anon/authenticated/service_role. Assinaturas, ACLs e fontes esperadas das três funções existentes constam em `driver-readiness-sql-contract.json`. A migration aborta se uma fonte divergir. Não se usa `db push`.

## Gates e evidências

- 41 testes focados de modelo, componente, entrada, consultas offline, Home/Journey e banco PGlite: respostas negativas, legado, payload inválido, CAS, propriedade, ausência de início automático e custódia completa.
- Playwright móvel local: quatro cenários do transporte real IndexedDB, incluindo seis perguntas, gravação offline, reabertura, sincronização única e isolamento por ator/empresa. Somente fixture loopback e transporte sintético, sem requisições externas.
- Pipeline local: 237 passaram, um skip preexistente, zero falhas. Edge syntax: 120 arquivos aceitos. Typecheck, lint, manifesto e baseline são gates antes do commit.
- CI exige `validate`, todos os shards `unit-tests` e `database-and-e2e` no SHA exato. Duas linhas de psql foram adicionadas ao estágio local já revisado, após o forward anterior, para executar o SQL e seu contrato real no PostgreSQL 17 descartável. Baseline privado e alvos loopback permanecem iguais.
- A verificação SQL usa sete usuários `.invalid`, transação revertida, writer offline real, replay idempotente, revisão obsoleta, flag de atenção calculada, início explícito e cargo `mark_departed`. A fixture de custódia pronta é declarada; o fluxo integral de provas também é exercitado pelo teste PGlite existente.
- As 46 migrations congeladas e manifestos anteriores permanecem intocados; o forward novo tem manifesto aditivo e hash próprio.

## Publicação e retorno

Após CI verde e novo preflight das fontes/ACLs: aplicar somente o SQL revisado, conferir hashes e permissões, integrar o mesmo candidato, aguardar Vercel e conferir `release.json` no alias. Comparar advisors antes/depois. Não produzir respostas de checklist em contas reais para testar. Smoke autenticado final depende de sessão disponível e deve ser distinguido dos testes sintéticos.

Retorno preferido: frontend anterior mantendo o backend aditivo que lê os formatos 1 e 2. Fontes anteriores completas estão em `driver-readiness-rollback-2026-11-13/`. Não restaurar SQL antigo enquanto houver eventos ou fila schema 2; o leitor antigo pode pedir novamente o checklist legado, mas nunca se convertem respostas negativas em oito itens OK. Falhas de gravação, isolamento ou custódia bloqueiam a liberação.

## Orientação para operação

Atualize o app e entre com o motorista vinculado à carga. Responda às seis perguntas com “Está OK” ou “Precisa de atenção”. Ao terminar, o app salva e abre a carga automaticamente. Problemas ficam registrados e permitem continuar. Se estiver sem internet, o checklist fica salvo no aparelho para sincronizar quando a conexão voltar.
