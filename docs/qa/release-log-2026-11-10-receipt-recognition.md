# Log de release — leitura de canhoto, 10/11/2026

## Identidade e estado

Responsável: Codex, solicitação operacional do usuário. Candidato na branch
`codex/receipt-handwriting-20261110`, base `c47f7ee314816467010c0b2c8e348a0eb9345155`.
Alvo: AGVLog, projeto `qcvnsdrbcchaxvawcngk`. Estado: preparação; publicação e
identidades finais serão registradas no PR e no artefato de entrega. O usuário
autorizou checkout isolado em C:, Git e publicação; dispensou smoke autenticado.

## Estado anterior e retorno

- Banco observado: 945 migrações, máximo `20261104194722`; reconfirmar antes do SQL.
- Edge anterior: `process-delivery-receipt-ocr` v11, verify_jwt=false, autenticada
  pelo segredo cron e RPC existente; cinco fontes recuperadas e preservadas em
  `edge-source-snapshots-2026-11-10-receipt-ocr-v11/manifest.json`.
- Frontend anterior: c47f7ee, publicação do despacho automático. Alias e SHA
  devem ser reconfirmados antes e depois da promoção.
- Retorno: desativar configuração privada do scheduler e adapter; restaurar
  bundle v11 completo e frontend anterior. Manter migração, resultados, jobs,
  leases e backoffs. `complete_v1` continua disponível; campos derivados novos
  não mudam a interpretação do leitor antigo. Não apagar canhotos nem cooldowns.

## Contrato e risco

Leitura assíncrona da imagem enviada, usando o gateway Lovable já adotado pelo
AGVLog e sua credencial existente. Nenhuma chave é enviada ao navegador. O
motorista recebe aviso do processamento. Imagem limitada a 3 MB, formato
verificado, tenant/path/hash ligados ao lease atual, sem URLs públicas.
Data escrita e presença visual de assinatura são metadados separados do horário
oficial da entrega e da validação do comprovante. Não autentica identidade nem
substitui assinatura obrigatória do formulário. Data sem ano, ilegível, futura,
baixa confiança ou assinatura incerta exige conferência; não inventar valores.
Texto é exibido como conteúdo, nunca HTML. Conteúdo da imagem é entrada não
confiável. Logs somente com contagens/status/códigos fixos, sem fotos ou texto.

Uma migração incremental, admitida por manifesto separado, preserva os 46
forwards congelados e os três releases CT-e. Writer apenas service_role; reader
authenticated, SECURITY INVOKER, RLS e escopo operador/admin da empresa.
Idempotência, lease, hash atual, auditoria e repetição preservados. Configuração
do cron inicia desativada, inclusive no CI. Ativar somente no alvo após teste
real do provider com duas imagens sintéticas; nenhuma entrega produtiva criada.

## Gates e evidências

- PGlite nativo: completar/repetir, conflito, data realista, incerteza, hash
  substituído, lease expirado, backoff e isolamento/ACL com papéis reais.
- Adapter/worker: provedor indisponível sem download/claim; hash e path; crédito,
  rate limit, resposta inválida, data e assinatura incertas.
- Interface: RPC vinculada à sessão/empresa/IDs e exibição dos metadados.
- Deno check do entrypoint e contrato SQL no banco exclusivo do Quality gate.
- Exigir validate, todos os shards unit-tests e database-and-e2e no mesmo SHA.
- Paridade histórica não é reparada; não executar db push. SQL específico,
  transação e conferência do ledger/contratos antes e depois da aplicação.
- Ordem: SQL/contratos, único bundle Edge reconciliado, frontend e ativação
  após self-test. Conferir alias Vercel, release.json e fonte Edge publicada.

## Observação e pendências

Nenhuma emissão fiscal, mensagem, foto real ou evento de entrega de teste em
produção. Self-test não grava recibos/jobs. O smoke autenticado permanece
dispensado, não deve ser descrito como executado. Créditos/limites do gateway
podem suspender a leitura; jobs recebem erro fixo e backoff, sem resultado falso.
Retornar/desativar se houver acesso cruzado, aplicação em hash obsoleto ou
mudança indevida do instante de entrega. Resultado final e links no PR.
