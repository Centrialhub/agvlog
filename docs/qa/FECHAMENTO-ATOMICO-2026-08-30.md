# Fechamento atômico por tentativa — candidato local

Estado: criação, recuperação, importação, edição auxiliar e exportações conectadas à página **apenas no código local**. Sem publicação em produção. Não declara concluídos o ciclo financeiro, os demais P1/P2 ou a prontidão integral do aplicativo motorista.

Continuação: o [ciclo auditado e a reserva de cobrança](FECHAMENTO-CICLO-AUDITADO-2026-08-30.md) substituem localmente as quatro transições administrativas legadas. Os números e pendências abaixo descrevem a etapa original do rascunho atômico.

## Entrega desta etapa

- A migração `20260830165149_make_closing_drafts_atomic.sql` depende da [fundação de leitura por tentativa](FECHAMENTO-TENTATIVAS-2026-08-30.md) e da cadeia operacional anterior. Recusa reaplicação; não deve ser publicada isoladamente sobre o backend atual.
- `create_closing_report_draft` cria cabeçalho, itens, resumos, número, histórico e confirmação durável na mesma transação. Valores e origens do modo sistema são reconstruídos no servidor: o navegador envia filtros, revisão, opções e cabeçalho, nunca itens ou totais como autoridade.
- O servidor verifica usuário, tenant e papel ativo; revalida membership depois de aguardar a chave idempotente. Bloqueia fontes em ordem consistente e recusa contenção sem manter uma gravação parcial. Uma revisão MD5 detecta alteração, não autoriza valores nem substitui controle de acesso.
- A confirmação durável é identificada por tenant/ator/request_id e hash do corpo. Replay retorna a confirmação original mesmo se a origem mudou depois. Corpo diferente com a mesma chave é negado. Registro append-only, sem DML de navegador e sem expiração automática.
- O navegador persiste somente o pedido necessário para replay, em chave versionada por ator/empresa, antes de transmitir. Resposta incerta exige recuperar esse pedido; contexto antigo não aparece após troca de sessão/empresa. Sem armazenamento ou Web Locks em contexto seguro, criação é recusada antes de transmitir. Dados importados podem conter informações comerciais no armazenamento local até a confirmação; não há tokens ou credenciais no pedido.
- Planilhas detalhadas e resumidas têm contratos separados e limite de 500 linhas/arquivo de até 5 MB na interface. Resumo mantém valores mesmo sem itens detalhados, não inventa notas/CT-es e exige período explícito. Toda importação é não auditada e bloqueada para aprovação financeira enquanto não existir conciliação própria.
- Identificação e horários de viagem vindos do sistema não podem ser alterados no fechamento. Quilometragem e combustível usam comparação com os valores anteriores, atualização transacional do grupo e recálculo sobre o estado completo. Diferenças ocultas entre itens da carga impedem sobrescrita. Repetição sem mudança não cria novo histórico; isso não equivale a um histórico durável de todas as edições.
- `mark_closing_report_sent` só registra o envio informado; não envia mensagem. Mantém o estado faturado, valida fontes e não duplica o mesmo registro de envio. Navegadores deixam de gravar diretamente nas seis tabelas de fechamento; APIs de consulta continuam com restrição de operador/empresa.
- Um CT-e com recebível existente exige revisão. Rascunhos com nova tentativa sem preço, fontes alteradas ou pendência financeira não podem ser fechados pela atualização protegida. A criação do rascunho não aprova cobrança.
- Excel/CSV/PDF usam totais por nota distinta e mostram carga/tentativa/resultado/revisão. Resumos importados não viram exportações vazias. CSV neutraliza prefixos de fórmula. A leitura de XLSX usa bytes explícitos para não interpretar ArrayBuffer de outro contexto como texto. A revisão visual completa de PDFs ainda é pendente.

## Verificação e limites

Fixtures aplicam as migrações reais sobre dados sintéticos locais. React é exercitado contra as RPCs SQL, não contra um simulador de regras financeiras. Isso não prova paridade integral do esquema Supabase hospedado nem substitui E2E autenticado em produção.

- 29 testes novos de banco/contrato/exportação: atomicidade, falha tardia com rollback da numeração, replay, stale revision, grants/RLS, limites de importação, rateio, recebível prévio, revisão financeira, edição de grupo e exportação de reentrega/resumo.
- 9 testes novos de React contra SQL: criação, resposta perdida e remount, origem alterada, alteração de filtro, troca de empresa/sessão, armazenamento indisponível, planilha XLSX real e edição de combustível/quilometragem com origem protegida.
- 207 casos PostgreSQL 17.11 nativos passaram, oito novos de fechamento: aplicação sem mutação operacional, duas criações idênticas, replay após mudança, fonte fiscal bloqueada, atualização fiscal serializada, revogação de papel durante espera, numeração concorrente e corte de DML. Cluster descartável em loopback encerrado com código zero.
- SHA-256 da candidata SQL efetivamente ensaiada: `6ddceefdcf0fa323be38533762b12fce25560fca9034afac93659890874e1cc9`.
- Advisors Supabase locais foram tentados: `ECONNREFUSED 127.0.0.1:54322`, pois não há stack Supabase local em execução. Testes de catálogo, ACL e RLS passaram na fixture; não foram apresentados como substitutos dos advisors completos. Nenhum advisor remoto nem nova exportação de esquema/funções de produção foi executado.
- Gate geral concluído com código zero: **1.930 testes em 155 arquivos**, 38 novos em relação à fundação de leitura. Node 22.23.2/npm 10.9.4; tipos, lint geral/crítico, baseline estrutural, sintaxe de 40 Edge Functions, build e scanner público aprovados. Lint estrito dos arquivos novos passou com zero avisos. Maior chunk: 488,3 KiB (limite 500 KiB).
- Cobertura do subconjunto configurado: 93,03% linhas/statements, 65,83% branches e 81,81% funções. Não representa cobertura integral do aplicativo ou de todos os arquivos novos. `git diff --check` aprovado; nenhum processo deste lote permaneceu em execução. O gate anterior de 1.892 testes/153 arquivos e 199 casos nativos pertence à etapa de leitura.

## Pendências antes de publicar

1. Endurecer e ensaiar fechamento/cancelamento/reabertura como máquina de estados, inclusive conflito com faturamento/pagamento. As RPCs legadas dessas ações não foram substituídas neste lote; o guard de origem é proteção adicional, não uma máquina de estados completa.
2. Implementar/ensaiar pagamento idempotente e conciliação do financeiro canônico. A fixture instala o contrato fiscal de chaves/RPC, mas não executa integralmente todas as dependências do ledger. Não afirmar E2E financeiro completo.
3. Impedir cobrança duplicada da mesma origem entre fechamentos diferentes; criação de múltiplos rascunhos é permitida. Conciliar recebível já existente sem criar outro, resolver representação fiscal outbound/ambiente e precificação explícita de reentrega. O bloqueio atual não oferece ainda a tela de resolução dessas pendências.
4. Completar validações de exportação (visual e totais/grupos não aditivos), acessibilidade em navegador real, recuperação entre abas e cenários prolongados. Contenção/restauração deve preservar rascunhos, confirmações e evidências; não apagar histórico nem restaurar escritor financeiro inseguro.
5. Preflight restrito, publicação coordenada banco/frontend e validação autenticada das jornadas interligadas. Não publicar a árvore inteira ou contornar a rejeição anterior de exportação/DDL amplo. Credenciais para E2E devem ser configuradas por canal seguro, nunca no chat.

As orientações Supabase/PostgreSQL fundamentaram os grants explícitos, RLS, revalidação e locks. React orientou isolamento por sessão, recuperação versionada e componentes separados. Nenhuma alteração em produção, emissão fiscal, pagamento, mensagem externa, serviço pago ou chamada SSX neste lote. SSX permanece inativo.
