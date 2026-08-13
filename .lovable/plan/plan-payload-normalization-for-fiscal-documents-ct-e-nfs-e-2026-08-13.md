# Plan - Payload Normalization for Fiscal Documents (CT-e & NFS-e)

Based on the Hub Fiscal API v1 catalog (Aug 13, 2026), I will standardize the emission payloads to ensure consistency across CT-e and NFS-e, specifically focusing on address fields, tax regimes, and cargo/insurance structures.

## Proposed Changes

### 1. Address Normalization (`src/lib/fiscal/fiscalAddress.ts`)
- Enforce canonical uppercase fields (`UF`, `CEP`) alongside lowercase ones to support different municipality providers.
- Ensure `normalizeCep` always returns 8 digits (zero-padded).
- Ensure `normalizeIbgeCity` strictly validates for 7 digits.

### 2. CT-e Payload Alignment (`src/lib/fiscal/cteBuilder.ts`)
- Align `vPrest` (Value of Service) structure with SEFAZ canonical group `Comp`.
- Standardize `mercadoria` (Cargo) group using official fields: `content`, `produto` (predominant product), and `species`.
- Ensure `infSeg` (Insurance Information) is correctly nested within the `seg` array.
- Enforce `CRT` (Tax Regime) 1 for Simples and 3 for Normal emitters.

### 3. NFS-e Payload Alignment (`src/lib/fiscal/nfseBuilder.ts`)
- Standardize the `tomador` (Taker) and `prestador` (Provider) address blocks with canonical fields (`UF`, `CEP`).
- Align the `seguro` (Insurance) block to match the CT-e structure for audit consistency.
- Ensure `regimeEspecialTributacao` and `optanteSimplesNacional` are correctly derived from the emitter's profile.

### 4. Fiscal Proxy Hardening (`supabase/functions/hub-fiscal-proxy/index.ts`)
- Update the emission storage logic to capture the standardized `seguro` snapshot.
- Ensure `idIntegracao` generation handles multiple document types and retry attempts correctly.

## Technical Details
- Use `sanitizeIe` from `partyRegistry.ts` to prevent "UNKNOWN" values from reaching the Hub.
- Apply `money` rounding to all currency fields to prevent floating-point errors in SEFAZ validation.
- Maintain idempotency using the established `integrationId` strategy.
