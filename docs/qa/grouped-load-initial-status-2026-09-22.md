# Criação de cargas por agrupamento — 22/09/2026

## Incidente e causa

A tela de agrupamento enviava `changes.status = planned` para `create_grouped_load_v1`.
A função encaminhava esse campo para `apply_load_aggregate_command`, cujo contrato
rejeita status fornecido pelo cliente (`unsupported_load_fields:status`) e define
o estado inicial no servidor. A definição em produção confirmou esse caminho.

## Correção

- A tela deixa de enviar status e verifica os campos com `LoadHeaderChanges`.
- A função de agrupamento remove apenas o valor legado exato `status: planned`.
  Outros estados e campos continuam sujeitos às validações do comando canônico.
- Migração `20260922192742_fix_grouped_load_initial_status.sql` aplicada ao projeto
  `qcvnsdrbcchaxvawcngk`; definição e registro da migração conferidos após aplicação.
- Mantidos SECURITY INVOKER, row_security=on e EXECUTE somente para postgres/authenticated.
- A compatibilidade no banco atende as telas já abertas, sem depender de publicar o frontend.

## Validação

- 29 testes aprovados: 12 da regressão e 17 do comando agregado existente.
- Cobertura: payload antigo/novo, estado inicial, vínculo de documentos, replay,
  campos proibidos, capacidade, empresa, rollback e permissões.
- O teste local usa o comando agregado real; o vinculador de documentos é um fixture.
- ESLint dos dois arquivos TypeScript alterados aprovado.
- Typecheck global encontrou erros em arquivos fora desta correção:
  BillingEdi, OperationsDashboard, accountPeriodEvidencePanel,
  costCenterOperationsReview e ingestionReportMetricsReportedBugs.
- A tentativa de execução transacional em produção foi bloqueada pelas permissões
  do acesso administrativo (SET ROLE e EXECUTE). Nenhuma permissão foi ampliada.
  Não houve confirmação de criação pela sessão real do cliente.
- A consulta aos advisors não apontou esta função; os demais avisos preexistentes
  não foram alterados no escopo do incidente.

O cliente pode repetir a criação de carga na tela existente.
