# Log de correção M3 - quota do outbox de criação - 05/10/2026

## Identidade e estado

| Campo | Valor |
| --- | --- |
| Autor / revisor nativo | CodexMerge / frente exclusiva da réplica |
| Tarefa / checkout | native-blocker-followup-20261005, F:/AGVLOG/work/native-blocker-followup-20261005 |
| Fonte congelada e servida | aac2f89fac7f3180f80dcb69e66552427f6e87a1, árvore 8fafebee49417cc6727f7a0ca2818bd6fbf6fcef |
| Estado | Correção local; M3 nativo e aceite completo pendentes; sem publicação |
| Identidade final e evidências | Handoff externo com SHA/árvore, bundle incremental, delta e logs dos gates do próprio SHA |
| Fixtures | Unitários/SQL em memória; Chromium/contexto/Storage/Web Locks novos, offline, origem .invalid interceptada, respostas RPC sintéticas |
| Nova mudança manual | Usuário trabalha separadamente; não recapturada/incorporada. Snapshot f46e72020ffbed5d1a27dc73a85b40b7bc9a6736 permanece a única entrada manual desta correção |

## Falha confirmada e contrato

O relatório task-3/aac-manual-outbox-native.json registrou às 19:46:09 UTC o pedido de 503 notas selecionadas corretamente com 6.552.525 caracteres / 6.554.538 bytes UTF-8. Storage.setItem real levantou QuotaExceededError; commands estava vazio, portanto não houve RPC nesse evento. Essa medição pertence ao candidato aac, não ao corrigido.

NewLoadDialog concatena os números das NFs e copia a lista agregada em details.final_fields.invoice_number de todos os eventos, produzindo crescimento quadrático. O erro foi a representação persistida redundante, não seleção, SQL ou fixture de quota. Nenhuma nota/evento/campo foi removido, reduzido, truncado ou recalculado para passar. NewLoadDialog, hook, RPCs, schema, auditoria SQL e ledgers permanecem inalterados.

O codec síncrono usa uma tabela de strings longas repetidas sobre a árvore JSON inteira. Arrays/objetos têm tags separadas para não colidir com valores literais. Preserva todos os valores/tipos/ordem, campos presentes/null e Unicode. Exige round-trip JSON completo antes de persistir. Só usa envelope v2 quando ele é menor que v1. Um único setItem guarda dicionário e árvore; leitura exata das mesmas bytes continua obrigatória antes do RPC.

O payload enviado permanece o JSON normal completo. O leitor reconstrói v2 e continua lendo v1. Namespace e Web Lock continuam agvlog:load-creation:v1:<tenant>:<actor>:<kind>:<scope>; request_id não muda em recuperação. A comparação contra input editado usa o payload expandido. Invalidade de versão/tags/referências/chaves duplicadas ou namespace impede envio sem excluir entrada. Quota residual e Storage indisponível continuam bloqueando antes do envio; não há fallback sem persistência ou limpeza de outras entradas.

O ledger servidor compara o JSONB completo, incluindo audit_events (20260922195558_harden_complete_load_creation.sql:71–84). O codec não altera canonicalização, hashes, locks, grants ou validações. notesmax5000 em Zod não é usado pelo hook de criação e não justificou uma alteração de SQL ou truncamento; eventual outro limite nativo continua sujeito ao ensaio do revisor.

## Evidências locais e limites

Em draft, 57 testes de quatro arquivos passaram: 18 novos de codec/quota/durabilidade, 12 de recovery, 12 do wrapper SQL real com downstream parcial e 15 do diálogo/filtro/505→503 IDs. Typecheck/lint também passaram. Gates do SHA comprometido serão registrados separadamente, sem aprovar o draft ou a fonte aac por esse resultado.

O novo scripts/test-load-creation-outbox-browser.mjs executa os módulos legado real e candidato em Chromium exclusivo offline, sem iniciar servidor da aplicação ou usar banco. Em 20:41 UTC, o modelo sintético completo com 503 notas e 503 eventos reproduziu QuotaExceededError no legado antes do envio; caiu de 6.931.755 caracteres / 6.934.774 bytes UTF-8 para 424.090 caracteres / 427.109 bytes UTF-8 armazenados. O JSON enviado e recuperado manteve o mesmo SHA256 integral; reload não gerou outro UUID; leitor antigo bloqueou v2 e preservou a entrada; quota cheia reteve entradas alheias e fez zero envios.

Esses tamanhos pertencem ao modelo sintético, não são a nova medição do pedido nativo original. A resposta RPC do ensaio Chromium é controlada. PGlite/JSdom/Chromium local comprovam execução do contrato cliente e SQL parcial; não comprovam Auth/PostgREST/banco completos nem aprovam M3 ou os 18 objetivos. As novas evidências finais apontam sempre ao SHA/árvore do próprio código.

## Aceite nativo exigido

1. Servir o novo SHA sem alterar aac, o original ou a frente manual em trabalho. Não há migration nova nesta correção; manter o nono suplemento de estoque e os anteriores pelos hashes já revisados.
2. Repetir os filtros e a seleção real de 503 notas, mantendo todos os objetivos M2/M3 e IDs exatos persistidos. Medir caracteres e bytes do envelope realmente gravado. Comparar o payload decodificado completo com o wire enviado, incluindo todos os 503 eventos/valores; não conferir apenas cardinalidade.
3. Conferir uma carga planejada, vínculos exatos, totais, notas integrais, ledger completo/aggregate e 503 eventos com details/request_id/created_by/tenant/load corretos. Perder a resposta após commit, recarregar e recuperar o mesmo request; confirmar uma carga e nenhum novo vínculo/audit após replay.
4. Repetir erros de quota restante, Storage negado/inconsistente, confirmação incompatível, payload/audit editado, troca de tenant/ator, legacy v1 e v2. Não enviar sem comando durável; preservar pendências incertas e negar edição do pedido.
5. Revalidar todos os 18 critérios e gates extensivos no candidato combinado. A nova mudança manual só entra após aviso explícito de conclusão, novo snapshot/diff revisado e nova validação conjunta.

## Compatibilidade e retorno

O cliente aac lê a mesma chave e rejeita version2; não ignora/apaga a pendência nem inicia outro pedido, mas não consegue recuperá-la. Um retorno operacional deve manter/backportar o leitor v2, ou resolver as pendências por cliente compatível antes do downgrade. Bloqueio seguro do legado não equivale a recuperação compatível ou rollback aprovado. Não apagar localStorage para liberar a tela.

O round-trip e readback protegem contra perda causada pelo codec/escrita; validação estrutural rejeita corrupção inválida. Nenhum checksum criptográfico contra alteração local válida foi introduzido; isso também era limite do formato v1. A igualdade do ledger servidor continua protegendo retries do pedido já registrado.

Nenhuma réplica, navegador/sessão do revisor, serviço compartilhado, produção ou checkout manual foi alterado. Não há enqueue/integrate ou commit final de entrega. Publicação, rollback operacional e novas alterações manuais exigem os aceites e autorizações posteriores.
