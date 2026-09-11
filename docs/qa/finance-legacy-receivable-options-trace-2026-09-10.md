# Consulta e rastreabilidade dos recebimentos antigos

Implementação local: migrations `20260910145659_finance_legacy_receivable_association_options.sql` e `20260910150338_finance_legacy_receipt_movement_trace.sql`, sobre core `20260910145616_finance_legacy_receipt_associations.sql`.

A consulta de associação retorna diagnóstico, revisão obrigatória da origem, entradas compatíveis e capacidade compartilhada. Candidatos e histórico são paginados em vinte itens. Datas inválidas continuam visíveis como pendência, sem candidatas. A seleção é explícita; valor/data não provam identidade nem autenticidade bancária.

A trilha da entrada inclui vínculos canônicos e associações antigas antes de contar e paginar. Vínculo antigo tem `command_id=null`: não inventa comando histórico. Identidade canônica usa o command_id real, e identidade legada usa o link_id. Associação, reversão da associação, correção da baixa e devolução real têm campos separados. Autor, motivo, data e declaração preservada ficam acessíveis também pelo histórico do título, mesmo após a saída do inventário.

Sete testes SQL executaram ambas as migrations e validaram respostas com os schemas reais da interface: compatibilidade, capacidade compartilhada, reversão/reassociação, paginação, autorização, data inválida e paginação mista. A preparação de dados antigos suspende exclusivamente o guard de comando obrigatório durante seu INSERT; reativa antes de qualquer comando sob teste e mantém demais constraints. No cenário misto, comandos canônicos ocorrem com título válido; a inserção histórica posterior não ignora a proteção de reconciliação do título. A fixture não equivale à cadeia integral de migrations ou a dados reais do cliente.

Rodada integrada: 53 testes passaram em oito arquivos (core 7, consulta/trilha 7, interface 9, cliente 4, inventário 1, trilha UI 4, contrato 2, regressão de projeção 19). ESLint do escopo root passou. O TypeScript global tem validação separada no registro de implementação.

Concorrência nativa do core: dez testes PostgreSQL 17.11 passaram, sessão80695 encerrada com código0 e servidor parado. Hash SHA256 conferido: `c0f2ba253350a39f0c8ec117df2f4883ad655fff1e0c65eeddac486fe6fa8848`. Ver relatório nativo para o escopo específico; esses testes não incluem a nova consulta de trilha.

Sem aplicação remota ou homologação de navegador. Outras fontes legadas, carteira inicial completa e fechamento continuam pendentes.
