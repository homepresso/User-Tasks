# @usertasks/sdk

TypeScript client for the UserTasks REST API (`/api/v1`).
Its types are generated from the server's OpenAPI 3.1 document, which ships with the package as
`@usertasks/sdk/openapi.json`. It is ESM-only and needs Node.js 20 or later (or any runtime with
`fetch`).

```bash
npm install @usertasks/sdk
```

```ts
import { apiKeyAuth, createClient, isUsertasksApiError } from '@usertasks/sdk'

const client = createClient({
  baseUrl: 'https://tasks.example.com',
  auth: apiKeyAuth(process.env.USERTASKS_API_KEY!),
})

// Typed by path and method; the { success, data } envelope is unwrapped.
const { workflows } = await client.GET('/workflows', { query: { limit: 10 } })

const role = await client.POST('/roles', { body: { name: 'Approver', permissions: ['tasks.complete'] } })

// Every page of a list endpoint
for await (const user of client.paginate('/users')) console.log(user)

try {
  await client.DELETE('/roles/{id}', { path: { id: 'system-role-id' } })
} catch (error) {
  if (isUsertasksApiError(error)) console.error(error.status, error.code, error.message, error.details)
}
```

- **Errors.** A failed request throws `UsertasksApiError`, which carries `status`, `code`,
  `details` and `requestId`. A network failure throws `UsertasksNetworkError`.
- **Retries.** Idempotent requests are retried on 429, 5xx and network errors, with backoff that
  honours `Retry-After`.
- **Untyped calls.** `client.request(method, path, options)` calls any endpoint without types.
- **OAuth.**
  - `oauthAuth()` provides tokens that refresh automatically and never refresh twice at once.
    It takes a lock if your token store provides one.
  - Helpers cover PKCE (`generateCodeVerifier`, `codeChallengeS256`), discovery, code exchange,
    refresh, revocation and dynamic client registration.
- **Operation metadata.** `OPERATIONS` gives each operation's method, path, permission and CLI
  metadata.

## License

Apache-2.0
