# Crypto & IDs (`ut_crypto`)

Identifiers and cryptography for UserTasks workflows: UUID v4 and v7, ULIDs, SHA hashes, HMAC signatures with a stored secret, base64 / hex / URL encoding, random codes, one-time codes and compact HS256 JSON Web Tokens.

Official UserTasks workflow action, version 1.0.0. Source: `src/action.ts`; built module: `dist/action.js` (one self-contained ES module that runs in the UserTasks QuickJS sandbox).

## Operations

### UUID (`uuid`)

Generate UUIDs: v4 (random) or v7 (time-ordered: sorts by creation time, good for database keys). v7 IDs from one call are strictly increasing.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `version` | choice: `v4`, `v7` | no | `"v4"` | v4 random, or v7 time-ordered. |
| `count` | integer | no | `1` | Number of UUIDs to generate (1–1000). |
| `uppercase` | boolean | no | `false` | Upper-case hex digits. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `uuid` | string | The first (or only) UUID. |
| `uuids` | list of strings | Every UUID generated. |

### ULID (`ulid`)

Generate ULIDs: 26-character, time-ordered, URL-safe IDs (Crockford base32). ULIDs from one call are strictly increasing.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `count` | integer | no | `1` | Number of ULIDs to generate (1–1000). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `ulid` | string | The first (or only) ULID. |
| `ulids` | list of strings | Every ULID generated. |

### Hash (`hash`)

The SHA-256, SHA-512, SHA-384 or SHA-1 digest of a text (UTF-8), as hex, base64 or base64url. For fingerprints, de-duplication and integrity checks; do not use plain hashes for passwords.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | text | no |  | The text to hash (UTF-8; empty text has a hash too). |
| `algorithm` | choice: `SHA-256`, `SHA-512`, `SHA-384`, `SHA-1` | no | `"SHA-256"` | Digest algorithm. |
| `encoding` | choice: `hex`, `base64`, `base64url` | no | `"hex"` | How the digest is written. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `hash` | string |  |
| `algorithm` | string |  |

### HMAC signature (`hmac`)

Sign a message with HMAC using the hmac_key secret, or check a received signature (e.g. a webhook's X-Signature header) in constant time. The secret never enters the action's code.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `message` | text | yes |  | The exact text to sign, e.g. the raw webhook body. |
| `algorithm` | choice: `SHA-256`, `SHA-512`, `SHA-384`, `SHA-1` | no | `"SHA-256"` | HMAC hash. |
| `encoding` | choice: `hex`, `base64`, `base64url` | no | `"hex"` | How the signature is written (match what the sender uses). |
| `expected` | string | no |  | Optional: a received signature to compare with (a sha256= prefix is ignored). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `signature` | string |  |
| `matches` | boolean | Whether Signature to check equals the computed signature (empty when none was given). |

### Encode (`encode`)

Encode text (UTF-8) as base64, base64url, hex or URL percent-encoding.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | text | yes |  | The text to encode. |
| `format` | choice: `base64`, `base64url`, `hex`, `url` | no | `"base64"` | Encoding. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | text |  |

### Decode (`decode`)

Decode base64, base64url, hex or URL percent-encoding back to text (UTF-8). Invalid input fails with a clear message.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | text | yes |  | The text to decode (whitespace is ignored for base64 and hex). |
| `format` | choice: `base64`, `base64url`, `hex`, `url` | no | `"base64"` | Encoding. |
| `plus_as_space` | boolean | no | `false` | URL format: decode + as a space (HTML form encoding). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | text |  |

### Random code (`random_code`)

Generate unbiased random codes from an alphabet: digits, letters and digits, hex, or no look-alikes (no 0/O, 1/I/L) for codes people read and type. Optional grouping such as XXXX-XXXX.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `length` | integer | no | `8` | Characters per code, not counting separators (1–256). |
| `alphabet` | choice: `no_lookalikes`, `digits`, `alphanumeric`, `alphanumeric_upper`, `letters_upper`, `hex`, `custom` | no | `"no_lookalikes"` | Which characters to use. |
| `custom_alphabet` | string | no |  | With Alphabet = Custom: the characters to use (at least 2). |
| `count` | integer | no | `1` | Number of codes to generate (1–1000). |
| `group_size` | integer | no | `0` | Insert the separator every N characters (0 = no grouping). |
| `separator` | string | no | `"-"` | Placed between groups. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `code` | string | The first (or only) code. |
| `codes` | list of strings | Every code generated. |

### One-time code (`otp`)

A numeric one-time code (e.g. for email or SMS verification) with its expiry time and SHA-256 hash: store the hash, not the code, and compare hashes when the user types it.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `digits` | integer | no | `6` | 4–10 digits. |
| `expires_minutes` | integer | no | `10` | How long the code is valid. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `code` | string | The code (keeps leading zeros). |
| `expires_at` | datetime | UTC instant. |
| `code_hash` | string | SHA-256 hex of the code. |

### Sign token (JWT) (`sign_token`)

Create a compact HS256 JSON Web Token signed with the token_secret secret: your claims plus iat, exp (from Expires in), optional iss / aud / sub and a unique jti.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `claims` | object | no |  | The token's data, e.g. { "role": "approver", "request_id": "REQ-1042" }. |
| `expires_minutes` | integer | no | `60` | Lifetime of the token; 0 for no expiry. |
| `issuer` | string | no |  | Optional issuer claim. |
| `audience` | string | no |  | Optional audience claim. |
| `subject` | string | no |  | Optional subject claim, e.g. a user id. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `jwt` | string | header.payload.signature |
| `expires_at` | datetime | UTC instant (empty without expiry). |
| `claims` | object | Every claim in the token. |

### Verify token (JWT) (`verify_token`)

Check an HS256 token signed with token_secret: the signature (constant-time), expiry (exp) and not-before (nbf) with a leeway, and optionally the issuer and audience. Invalid tokens return valid = false and a reason instead of failing the step.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `jwt` | string | yes |  | The token (a "Bearer " prefix is ignored). |
| `issuer` | string | no |  | Optional: iss must equal this. |
| `audience` | string | no |  | Optional: aud must equal or contain this. |
| `leeway_seconds` | integer | no | `30` | Tolerance for exp and nbf. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `valid` | boolean |  |
| `reason` | string | Why the token is not valid: malformed, unsupported algorithm, bad signature, expired, not yet valid, issuer or audience does not match (empty when valid). |
| `claims` | object | The token's claims when the signature is valid (also when expired), else empty. |
| `expires_at` | datetime | From exp (empty without expiry). |

## Capabilities

Secrets only (no network, data tables or files):

- `hmac_key`: used by `hmac`. The host computes the HMAC with `secret://hmac_key`, so the key never enters the sandbox.
- `token_secret`: used by `sign_token` and `verify_token` (HS256, also computed on the host).

Both are optional: an administrator sets them in Extensibility → Workflow actions. An operation that needs an unset secret fails with a message naming it; the other operations work without any setup. Random values come from the host's cryptographic generator (ctx.crypto.randomBytes / randomUUID).

## Examples

**SHA-256 of "abc"** (`hash`)

```json
{
  "text": "abc",
  "algorithm": "SHA-256"
}
```

**Check a webhook signature** (`hmac`)

```json
{
  "message": "{\"event\":\"invoice.paid\",\"id\":\"evt_1042\"}",
  "expected": "sha256=1c1b1b59b8b80733797d06dae9234186bd3e41395f81d2773aa87f70daeaa4b3"
}
```

Signed with the hmac_key secret (the example uses the value "example-secret").

**Verify a signed token** (`verify_token`)

```json
{
  "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwicm9sZSI6ImFwcHJvdmVyIiwiaXNzIjoidXNlcnRhc2tzIiwiYXVkIjoiYXBwcm92YWxzIn0.ViY7aLGdekI4TR6SYbUEvxrBc4VtgmtpczNL4qmy6YU",
  "issuer": "usertasks",
  "audience": "approvals"
}
```

Signed with token_secret = "example-secret".

**Base64 of UTF-8 text** (`encode`)

```json
{
  "text": "Hello, Wörld & friends",
  "format": "base64"
}
```

**Decode a URL parameter** (`decode`)

```json
{
  "text": "name%3DAroha%20Smith%26role%3Dapprover",
  "format": "url"
}
```

A sample workflow ships in `assets/workflows/`: it starts from the API or its start form, runs this action with default inputs and shows the outputs.

## Limits

- Each run has 5 seconds and 32 MB of sandbox memory; inputs and outputs are limited to 5 MB of JSON each.
- Up to 1,000 UUIDs, ULIDs or codes per run; codes up to 256 characters; text to hash, sign or encode up to 5,000,000 characters.
- UUID v7 and ULID values from one run are strictly increasing (a counter in the random bits within the same millisecond).
- Random codes use rejection sampling, so every character of the alphabet is equally likely.
- Tokens: HS256 only (other algorithms, including "none", are rejected); exp / nbf are checked with a leeway (default 30 seconds).
- Plain hashes are not for passwords; SHA-1 is offered for legacy systems only.

## Build and test

```sh
node gallery/actions/scripts/build.mjs crypto-ids
npx vitest run __tests__/gallery-action-crypto-ids.test.ts
```

## Licence

Apache-2.0. Copyright UserTasks.
