import { apiRoute } from '@/lib/api/route'
import { getWorkspaceEmbeddingEndpoint, updateWorkspaceEmbeddingEndpoint } from '@/lib/api-schemas/workspace-address'
import { getWorkspaceEmbedding, setWorkspaceEmbedding } from '@/lib/services/tenant-settings'

/** GET /api/v1/workspace/embedding */
export const GET = apiRoute(getWorkspaceEmbeddingEndpoint, async ({ ctx }) => getWorkspaceEmbedding(ctx))

/** PUT /api/v1/workspace/embedding */
export const PUT = apiRoute(updateWorkspaceEmbeddingEndpoint, async ({ ctx, body }) => setWorkspaceEmbedding(ctx, body))
