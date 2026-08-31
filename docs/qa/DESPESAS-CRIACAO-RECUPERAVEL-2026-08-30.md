# Criação recuperável de despesas — 30/08/2026

Estado: implementação local; **não publicada**. A meta completa de prontidão do aplicativo permanece em andamento.

Atualização posterior: a revisão individual encontrou uma lacuna de MFA na criação e no recálculo; há uma [correção forward de MFA](DESPESAS-MFA-2026-08-30.md). A publicação deve incluir essa correção e o gateway correspondente. As evidências abaixo são históricas do lote original.

## Correções deste lote

- Motorista e operação usam a mesma criação transacional. Pedido, ator, empresa, origem e revisão são verificados no servidor. Reenvio idêntico recupera a confirmação original, sem outra despesa.
- Valores são transmitidos em centavos inteiros. Categoria, data, hodômetro, pagamento, reembolso, adiantamento e ausência de comprovante têm validação coerente.
- Despesas manuais têm vínculo explícito com o acerto, inclusive quando não há viagem. Aprovação/rejeição reutiliza a revisão auditada existente.
- Recálculo manual mantém itens e totais de despesas aprovadas, pendentes e rejeitadas. Apenas o reembolso aprovado integra o valor devido ao motorista. Nenhum pagamento é criado.
- Itens manuais legados com origem ambígua impedem o recálculo, preservando os itens. Não há atribuição presumida nem zeragem silenciosa.
- Histórico do motorista é paginado, separado por empresa/ator e apresenta motivo da revisão. Viagens planejadas, em trânsito e concluídas do próprio motorista podem ser selecionadas.
- Formulário compartilhado possui labels e nomes acessíveis. O painel de recuperação está nos layouts do motorista e da operação.

## Comprovantes e recuperação

O caminho é derivado no servidor: empresa / expense-receipts / ator / pedido / receipt.ext. O pedido contém hash SHA-256, tamanho e MIME, não uma URL arbitrária.

O gateway verifica identidade, papel, origem, conteúdo e scanner. Metadados de procedência são escritos pelo gateway via Storage API. O banco somente lê esses metadados. Um objeto confirmado é reutilizado; nunca sobrescrito.

INSERT/UPDATE/DELETE de navegador no diretório reservado são negados. Upload genérico e limpeza privilegiada também recusam esse diretório. Leituras permitem operação autorizada, autor do arquivo ou motorista dono da despesa. Não confundir os metadados do objeto controlados pelo gateway com claims editáveis de usuário no JWT.

A fila local é versionada e separada por empresa/ator. Persiste o pedido antes de enviar e distingue envio do arquivo de submissão da despesa. Não guarda arquivo em base64, tokens ou URLs assinadas. Após recarregar, reconhece arquivo já recebido; caso contrário, exige selecionar o mesmo arquivo.

Depois de uma possível submissão, a fila não pode ser descartada: deve recuperar a mesma confirmação. Antes da submissão, o usuário pode descartar o envio não registrado; eventual arquivo recebido é preservado. Limpeza/retenção definitiva de arquivos órfãos ainda precisa de política específica, sem apagar evidência em uso.

## Evidência

- Cinco reproduções do legado: duplicação por reenvio, ausência não declarada de comprovante, caminho de outra empresa, campos econômicos incoerentes e perda de itens no recálculo manual.
- Testes SQL da candidata incluem criação/replay, autorização, invariantes, falha tardia com rollback, aprovação, recálculo, decisão visível ao motorista, RLS de comprovantes e preservação de vínculos legados.
- Testes das telas reais usam SQL local; incluem preenchimento por label, seleção de viagem, perda de resposta, troca de sessão, erro de consulta, paginação e arquivo através do contrato do gateway.
- Testes da fila cobrem suas fases e confirmação incorreta. Testes do gateway simulam scanner e Storage, incluindo resposta perdida, acesso revogado durante scan e arquivo divergente.
- Suíte nativa final: **259 casos aprovados** em PostgreSQL 17.11, com código zero e cluster descartável encerrado. São 12 novos casos sobre os 247 do lote anterior: nove de criação e três de contenção/retomada com concorrência real.
- Gate final: **2.186 testes em 183 arquivos aprovados**, tipos, lint, qualidade, 41 sintaxes Edge, build e inspeção do artefato público, encerrado com código zero. Node 22.23.2 e npm 10.9.4; build em 18,17 s, maior chunk 488,3 KiB, sem source maps ou segredos reconhecidos no artefato público.
- O lote de criação/recuperação acrescentou 66 testes. A regressão também inclui nove testes da extração de PayrollStatusBadge e 33 testes de alterações simultâneas de outros módulos; não atribuir todo o aumento a despesas. O limite de qualidade não foi relaxado e os filtros existentes da folha foram preservados.
- Contenção: 11 testes SQL e dois testes de tela/SQL verificam suspensão, rejeição de drift, preservação de comprovantes/auditoria, retomada e recuperação do mesmo pedido. Os três testes nativos novos verificam transação ativa, criação disputando com contenção ainda não confirmada e impossibilidade de ignorar a guarda por execução como proprietário.
- Cobertura do subconjunto configurado: 93,03% statements/linhas, 65,83% branches e 81,81% funções. Não equivale à cobertura integral nem a E2E hospedado/Axe real.

Migração candidata: 20260830211707_make_driver_expense_creation_recoverable.sql.
SHA-256: bdcf404396ed97340051f8c30a9d6ab21fde917b247066efb2ab8fd5818d91d7.

Contenção: EXPENSE-CREATION-CONTAIN-2026-08-30.sql, SHA-256 05cffe4e5cdc29218770cbf558e1d704ab616c5e9fb1708a1e5d73cdc6108a31.
Retomada: EXPENSE-CREATION-RESUME-2026-08-30.sql, SHA-256 aae8f1fb86897fee510e4f84c0781961da8ca57858cda8dd09aa58499fb679d4.

As migrações anteriores de revisão de despesas, faturas e recebimentos/estornos mantiveram os hashes previamente verificados. O diff dos arquivos alterados neste lote foi conferido. Há alterações simultâneas em outras telas, que não foram revertidas.

Os assessores Supabase locais não executaram: conexão recusada em 127.0.0.1:54322, pois a stack completa não está disponível. Isso não é aprovação dos assessores. PostgreSQL nativo e PGlite não substituem Auth/Storage/PostGIS e E2E hospedado.

## Publicação e pendências

Este lote revoga os dois escritores legados de despesa. **Não publicar somente o banco ou somente as telas.** Contenção/retomada foram ensaiadas localmente; ainda é necessário conferir contratos publicados, dados legados e coordenar banco, gateway e frontend com verificação autenticada posterior. O procedimento e os limites estão em [publicação e contenção](DESPESAS-PUBLICACAO-CONTENCAO-2026-08-30.md).

Antes da liberação: confirmar Storage privado e metadados da API real, configuração e custo do scanner, retenção de comprovantes legados/órfãos, conciliação dos vínculos antigos e Axe/navegador real. Restam também os demais P1/P2, configuração de convites, revisão individual de privilégios e proteção fiscal.

Nenhuma emissão fiscal ou pagamento real, mensagem externa, integração SSX ou serviço pago foi acionado por estes testes. Valores financeiros sintéticos existem apenas nas fixtures descartáveis. Nenhum arquivo real de produção foi enviado ou apagado. O SSX permanece inativo.

Referência de implementação: [Supabase Storage — schema e operações pela API](https://supabase.com/docs/guides/storage/schema/design). As skills de Supabase/Postgres orientaram permissões explícitas, RLS e ordem de locks; a de React orientou isolamento de sessão e persistência versionada mínima.
