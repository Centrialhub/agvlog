# Acesso operacional ao chat com motoristas

Base b03d486ed602e024c3d4b719f8d496f29d339391. Diagnóstico: a UI DriverChatDrawer/DriverConversation já existe em /events, porém só é acessível em um agrupamento de motorista expandido com ocorrência nos filtros atuais. Não existe entrada geral no menu nem rota operacional independente de ocorrência.

Correção mínima: /driver-chat e item Chat com motoristas em Rastreamento e ocorrências, limitados aos papéis internos owner/admin/operator existentes. A página usa o catálogo paginado autorizado useDrivers, com tenant/actor nas chaves, e reutiliza DriverConversation e suas regras RPC/RLS/MFA, identidade, contexto revisionado, histórico e recuperação. Inclui inativos para histórico, mantendo can_send do servidor como autoridade. Chave de tenant/actor/papel remonta a página e limpa seleção/rascunho; falha de catálogo oculta a conversa e mostra erro.

Nenhuma ocorrência é necessária. Nenhuma migration, backend ou regra é alterada. A ausência percebida não foi tratada como ausência de implementação: a causa concreta é o acesso condicionado a ocorrências.

Aceite local: identidades sintéticas em SQL PGlite isolado com cursor reader e chat RPCs reais. Formulário de motorista envia; operação encontra motorista pelo novo acesso, lê e responde; motorista vê resposta. Cobrir histórico persistido/remontagem/atualização, papéis e tenants negados, troca de sessão, catálogo indisponível e destinatário inativo. Repetir em navegador e depois no ambiente nativo de homologação antes de integrar/publicar. Auth/claims locais de fixture não aprovam GoTrue/realtime hospedado ou produção.

Fonte PWA b03 congelada, 26 forwards e manifests/A6 E1/C8 preservados. Sem tocar manual-updates/task-2, fontes c461/487 ou serviços/réplica/testes do revisor; sem 500 Auth QA, A13 Auth/Storage, enqueue/integrate ou publicação.

## Navegador local real

O script test-operational-driver-chat-browser.mjs compila os componentes reais, menu e guards ProtectedRoute/DriverRoute e usa Supabase JS real para RPCs no servidor loopback próprio, com SQL cursor/chat real em PGlite. Cinco cenários exercitam envio nos dois sentidos e atualização por polling, recarga/histórico, troca de tenant/rascunho, negativas de guard e papel forjado e três negativas SQL diretas. Há exatamente dois registros sintéticos, com sender_id/sender_role definidos pelo servidor.

Limite explícito: os hooks de Auth/tenant/lookup do motorista e claims são fornecidos pela fixture; o catálogo, componentes, guards, SDK e RPC/RLS/MFA são reais. O teste não prova login GoTrue nem realtime WebSocket hospedado. Os builds da fixture não representam validação visual da aplicação completa. Não envia mensagens ou clientes produtivos. Repetir o mesmo fluxo com identidades nativas e papéis/tenants negados na homologação.
