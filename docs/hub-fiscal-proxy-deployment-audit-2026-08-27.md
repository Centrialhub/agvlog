# Auditoria de implantação — hub-fiscal-proxy

> Documento histórico. As referências a MFA/AAL2 abaixo foram substituídas em
> 28/08/2026 pela autenticação de fator único com autorização obrigatória por
> tenant e papel. Consulte `production-runbook.md` para o contrato vigente.

Data da verificação final: 28 de agosto de 2026.

Projeto de produção: `qcvnsdrbcchaxvawcngk` (`PROJETO AGV LOG`).

## Estado remoto reconciliado

- Função: `hub-fiscal-proxy`.
- Versão ativa: `63`.
- Status: `ACTIVE`.
- `verify_jwt=true`.
- Import map presente, apontando para o `deno.json` do pacote.
- SHA-256 do bundle remoto:
  `0236ebcf08f55f097ec4f1d440de487d259c728a7542d7e99a1a2a4e69e19446`.
- O código remoto contém a política CORS restritiva, resolução multi-tenant
  explícita e o gate compartilhado de AAL2.

## Pacote implantado

| Arquivo | SHA-256 local auditado |
|---|---|
| `supabase/functions/hub-fiscal-proxy/index.ts` | `74B2A50306E9C121CB2DA053309EE805EBAD6AED54F030F06928EC3436BE9007` |
| `supabase/functions/hub-fiscal-proxy/deno.json` | `D8688A8A90AF9D0E7A19AA196B5AE98BB362D9E9BE1C23FFC7C206F9F5D2F256` |
| `supabase/functions/_shared/cors.ts` | `F4A256B2E4B14C0D342B94B01E9B166D1D7030B6B222D822EC51423F402EC5A0` |
| `supabase/functions/_shared/auth-assurance.ts` | `85EC735BEC9413A578244C81DBD40368C10699AB2A768DE44BB5081A8A65E7FE` |

O verificador sintático aprovou os 37 arquivos TypeScript das Edge Functions.
O deploy preservou `verify_jwt=true` e incluiu o `deno.json` como import map.

## Mudanças de segurança verificadas

1. CORS anuncia somente `https://agvlog.lovable.app` por padrão, com override
   validado por `AGVLOG_APP_ORIGIN`; não há fallback wildcard.
2. A autenticação bearer continua validada por `auth.getUser()`.
3. Tenant é resolvido por recursos locais e cruzado com memberships ativas;
   não existe escolha implícita do primeiro tenant.
4. Chamadas de `owner` e `admin` exigem claim `aal2`; operadores mantêm o
   contrato AAL1 previsto.
5. Credenciais de emitente são resolvidas no servidor e falham fechado quando a
   chave de criptografia não consegue descriptografá-las.

## Verificação pós-deploy

| Verificação | Resultado |
|---|---|
| Versão/status/JWT/import map | versão 63 `ACTIVE`, `verify_jwt=true`, import map presente |
| CORS com origem oficial | `OPTIONS 200`, `Access-Control-Allow-Origin: https://agvlog.lovable.app` |
| CORS com origem hostil | sem wildcard; a resposta não coincide com a origem hostil e o navegador bloqueia |
| Requisição sem JWT | `POST 401` em produção, confirmado também no log da versão 63 |
| Owner/admin AAL1 no frontend | gate de MFA exibido, sem console error/warning |
| Owner/admin AAL2 | ping autenticado ainda depende de sessão AAL2 e confirmação para transmitir o token |
| Operações fiscais destrutivas | nenhuma emissão, cancelamento, descarte, entrega ou e-mail foi executado |

Os logs observados contêm apenas os dois preflights `OPTIONS 200` e o smoke
`POST 401`; nenhum token, senha ou payload fiscal foi registrado.

## Efeitos materiais do handler

O handler aceita operações capazes de emitir, consultar, sincronizar, cancelar,
descartar, importar, entregar e enviar por e-mail documentos fiscais. Ele
também pode transmitir dados fiscais e credenciais de integração para Hub e
ManagerSaaS. O deploy alterou o código das chamadas futuras, mas não executou
essas ações por si só.

O único passo de runtime ainda não realizado é o ping autenticado com uma sessão
AAL2. Ele é não destrutivo, porém exige intervenção do titular da sessão para o
MFA e confirmação no momento de transmissão do token.
