# Conferência administrativa de notas antes do despacho

Pedido: marcar cada nota como conferida após pesquisá-la, manter a marcação ao limpar a pesquisa/reabrir a carga e separar da reentrega e do canhoto recebido.

## Identidade e contrato

- Base publicada conferida em `/release.json`: `8a6ba9d9f1d1ad98b57b136871deeaa9e50c6425`, build `27de546d977769d5`, backend `qcvnsdrbcchaxvawcngk` (2026-11-16).
- Preflight do banco: 952 migrações, máxima `20261114114633`; tabela candidata ausente, helpers de autorização/preservação presentes.
- Migração incremental `20261116154757_load_note_pre_dispatch_checks.sql`; nenhuma função existente substituída, nenhuma Edge Function alterada. Manifestos anteriores preservados.
- Eventos imutáveis por empresa/carga/nota, autor autenticado, instante e revisão. Repetição idempotente por autor/request; CAS rejeita revisão obsoleta. Writer bloqueia carga/documento e valida vínculo atual antes de gravar. Leitura omite documentos que saíram da carga.
- Somente operador/admin autorizado na empresa. Motorista/cliente/anon sem escrita; sem DML direto. Metadados fiscais, resultados de entrega, custódia, valores e reentrega permanecem fora da ação.
- UI usa salvamento automático confirmado pelo servidor; em falha, recarrega o estado e informa que não confirmou. Sem marcação otimista. Contador considera toda a carga, mesmo com pesquisa aplicada. Sem novo bloqueio ao despacho.

## Validação

- PGlite com funções reais: persistência, identidade/carga, revisão obsoleta, replay, desmarcação, permissões e preservação integral da nota.
- React com o mesmo banco: pesquisar outra nota, limpar filtro, desmontar/reabrir e desmarcar sem usar Salvar Notas.
- Contrato SQL na base integral isolada do CI: seed de sete contas `.invalid`, RPC autenticada, replay/CAS, desmarcação, isolamento e negação ao motorista. Transação revertida; não executar esse arquivo em produção.
- Quality gate completo exigido antes da promoção: validate, oito shards unitários e database-and-e2e. Evidência final do SHA/run registrada no recibo de entrega.
- Não há emissão fiscal de teste, mensagens reais ou nova viagem produtiva nesta validação.

## Retorno e operação

Retornar o frontend ao SHA anterior oculta a coluna sem impedir leitura dos dados antigos. Manter a tabela/eventos e RPCs aditivas preserva histórico e permite retornar à versão nova. Não apagar eventos como rollback.

Uso: abrir carga → Notas Fiscais → pesquisar número → marcar **Conferida** → aguardar confirmação. Cada nota salva automaticamente; limpar a pesquisa mantém os checks. Para corrigir, desmarcar. Reentrega e Rec. Canhoto continuam nas ações próprias.

Smoke autenticado de produção pendente de sessão; não afirmar que a UI produtiva gravou uma nota sem evidência. Conferir alias/SHA e contratos publicados antes de entregar.
