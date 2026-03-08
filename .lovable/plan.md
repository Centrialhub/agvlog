

# Fix: `ssx-login` "Invalid time value" -- Stale Deployment

## Root Cause

The edge function logs show the error at **compiled line 242**, but the current source file has `.toISOString()` at line 235 (on a `Date.now()` value that can never be invalid). This means **the deployed function is stale** -- previous file edits were saved but never actually deployed to Supabase.

The original code (still running in production) likely has a `.toISOString()` call on a `Date` constructed from the SSX `ExpiresIn` value without proper validation.

## Additional Issue: `auth.getClaims()` may not exist

The function uses `anonClient.auth.getClaims()` (line 37) which is not a standard method in `@supabase/supabase-js@2`. This should be replaced with `anonClient.auth.getUser()` which is the correct way to validate a JWT and extract the user ID.

## Plan

### 1. Fix auth validation in `ssx-login`
- Replace `auth.getClaims()` with `auth.getUser()`
- Extract `callerId` from `data.user.id` instead of `claims.sub`

### 2. Add defensive Date handling
- Wrap the token expiry calculation in extra safety: use `try/catch` around `.toISOString()` with a hardcoded fallback
- Add `console.log` for the SSX response body (first 200 chars) to aid future debugging

### 3. Ensure redeployment
- The function must be redeployed after editing. The deployment tool will handle this automatically.

## Technical Detail

```text
Before (broken in production):
  auth.getClaims(token) → may not exist → unhandled error
  new Date(expiresInSeconds * 1000) → NaN if ExpiresIn is garbage

After:
  auth.getUser() → standard API, reliable
  const nowMs = Date.now()
  const expiresAt = new Date(nowMs + ttlMs) → always valid (ttlMs defaults to 86400000)
  try { iso = expiresAt.toISOString() } catch { iso = new Date(nowMs + 86400000).toISOString() }
```

