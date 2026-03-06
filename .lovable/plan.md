

## Diagnóstico

O Swagger da SSX mostra que o endpoint `/Login` recebe os parâmetros **via query string** (`"in": "query"`), e **não** no body da requisição. Por isso todas as tentativas (JSON body, form-urlencoded body) retornam HTTP 415 (Unsupported Media Type) com a mensagem "A propriedade Username é obrigatória".

Parâmetros do `/Login` (todos query string):
- `Username` (obrigatório)
- `Password` (obrigatório)
- `Hashcentral` (opcional, note: **Hashcentral**, não Hashcode)
- `HashAuth` (opcional)
- `ClientIntegrationCodeBus` (opcional)

## Plano de correção

### Arquivo: `supabase/functions/ssx-login/index.ts`

1. **Remover toda a lógica de loginAttempts com body** (linhas 105-152) e substituir por uma construção simples de URL com query params:

```typescript
const params = new URLSearchParams();
params.append("Username", account.username);
params.append("Password", password);
if (account.hashauth) params.append("HashAuth", account.hashauth);
if (account.hashcode) params.append("Hashcentral", account.hashcode);

const loginUrlWithParams = `${baseUrl}/Login?${params.toString()}`;
```

2. **Simplificar o fetch** para uma única chamada POST sem body:

```typescript
ssxResponse = await fetch(loginUrlWithParams, {
  method: "POST",
  headers: { Accept: "application/json" },
});
```

3. **Remover funções auxiliares** que já não são necessárias: `toFormUrlEncoded` e `shouldRetryLoginWithFallback`.

4. **Remover a variável `requestFormat`** e referências ao loop de retry, simplificando o fluxo de erro.

Todas as demais lógicas (cache de token, parse da resposta, logging) permanecem inalteradas.

