# XML NF-e preservado em contas a pagar — candidato local

## Problema e comportamento
O caminho legado exigia scanner externo indisponível. O hotfix audit41 impede salvar a conta quando o anexo falha; este candidato substitui apenas o fluxo XML do formulário por preservação privada no Supabase e vínculo atômico. A criação/edição sem XML continua no fluxo existente.

O XML NF-e (até 2.000.000 bytes) é lido estruturalmente com `saxes@6.0.0`: UTF-8 estrito, DTD/ENTITY/processing instructions recusados, tamanho/profundidade/nós/texto limitados, campos centesimais exatos. Não verifica assinatura digital, autorização fiscal ou malware. Não emite documento fiscal nem cria movimento bancário. XML NFS-e não suportado neste endpoint; diagnóstico visível. A leitura local do formulário não equivale a anexo concluído.

## Contrato
- Edge `finance-payable-xml`: POST multipart `tenant_id`, `request_id`, `file`. JWT validado por getUser, empresa ativa e get_finance_access. Validação antes de gravar bytes.
- `reserve_finance_payable_xml(_payload)` authenticated: version1/tenant/request/sha256/size_bytes; quota serializada 60 reservas por ator/empresa/hora. DTO seguro não contém path/ticket.
- `prepare_finance_payable_xml(_tenant_id,_actor_id,_artifact_id)` e `finish_finance_payable_xml(_payload)` são apenas service_role. Ticket 120s, hash de autorização, membership/driver rechecados, sem impersonação de JWT. Registro Storage exige tamanho/MIME/hash/artefato nos metadados.
- Bucket privado `payable-xml-quarantine`, path fixo `tenant/actor/request/original`, MIME octet-stream. Sem acesso browser mesmo sob política permissiva alheia; original imutável. Sem rota de download/signed URL do original. Não altera `secure-upload` ou buckets legados.
- `record_finance_payable_xml(_payload)` authenticated: version1/tenant/request/artifact/payable nullable/expected_revision nullable/fields revisados. Criação ou update de título + vínculo + resultado idempotente numa transação; RLS-equivalent management e todos os triggers financeiros existentes preservados. Locks e reautorização antes/depois de esperas, timeouts locais. Não permite transição para approved/paid; isso continua via comandos próprios.
- `get_finance_payable_xml_context(_tenant_id,_payable_id,_offset=0,_expected_revision=null)`: conta atual, revisão da conta, revisão do histórico, páginas de 50 metadados. Página posterior exige revisão; drift rejeitado.

## Proteções de negócio e recuperação
- Empresa/ator/arquivo/comando/valor validados no retorno; outbox antes do envio, WebLocks e replay exato. Não perde pendência sob retorno incompatível ou troca de contexto. Erro definitivo só limpa primeira tentativa; resposta desconhecida recupera o original.
- Atualização exige revisão do mesmo snapshot aberto no formulário; mudança detectada não gera atualização silenciosa.
- Mesma NF-e/SHA já vinculada a outro título ativo da empresa bloqueia criação/associação duplicada, sob trava por identidade. Não faz upsert silencioso. Anexar novamente à mesma conta é permitido com revisão atual. Título cancelado não impede novo registro.
- Valor do título pode representar parcela revisada; valor integral do XML é metadado independente. Este formulário NÃO cria múltiplas parcelas da mesma NF-e: reimportar para outra conta ativa é bloqueado, em vez de duplicar dívida.
- Sucesso do banco permanece terminal se invalidar/refazer consultas falhar; mensagem exige atualizar página, não novo envio. Histórico mostra original privado, emissor, documento, valor do documento, hash, ator e data.

## Evidências locais
2026-09-14 17:23:52, Vitest: **24 testes / 7 arquivos PASS**, incluindo:
- Parser real, DTD/PI, duplicidade de campos, centavos extras, arquivo grande/malformado.
- PGlite com predecessores reais: reserva/service ACL, cross-company/mixed-driver, expiração, hash ausente, resumo inválido, dois atores com mesmo request, política browser ampla, imutabilidade, replay, dedupe NF-e e update do mesmo título.
- Parsers frontend executados contra resultados SQL reais.
- Revisão independente bank: cadeia real 60519→regularização/retorno→81653/85400/92319 bloqueia sobrescrever complemento materializado; zero links/comandos e título/dinheiro intactos. Artefato recebido é precondição sintética explícita nesse teste separado.
- UI real Payables/FiscalXmlUpload com parser NF-e, upload recusado preserva campos/File e não chama mutações antigas; resultado desconhecido recupera mesmo comando com upload único; cache falho não cria retry novo.
- Transporte com receiver real do SDK simulado e requisição estável por hash; workflow Edge usa caminho fixo e não finaliza falha Storage.
- ESLint focal: zero erros/avisos após ajuste das dependências React.
- `deno check --config supabase/functions/finance-payable-xml/deno.json supabase/functions/finance-payable-xml/index.ts`: exit0.

## Limites e implantação
Nenhum deploy, SQL remoto, credencial ou XML real de cliente utilizado nesta tarefa. PGlite não é ensaio concorrente PostgreSQL nativo nem upload hosted; root controla esses checks e a publicação conjunta (migração → Edge → frontend). TypeScript global/build ficam com root. Não promover somente frontend antes dos endpoints. Runtime imports compartilhados listados no entrypoint devem acompanhar deploy: `_shared/fiscal-cors.ts`, `_shared/cors.ts`, `_shared/active-tenant.ts`, `secure-upload/bounded-request.ts` e dependências desses módulos existentes.

Allowlist e SHA de cada arquivo: `finance-payable-xml-preservation-allowlist-2026-09-14.json`. Arquivos de adiantamento WIP excluídos.
