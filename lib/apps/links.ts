/**
 * An app's shareable addresses (isomorphic, pure):
 *  - friendly: /app/<slug> — on the workspace address
 *    (https://acme.usertasks.com/app/<slug>), else on the main address with
 *    ?org=<workspace slug> so the sign-in page knows the workspace;
 *  - embed: /embed/apps/<slug> (full screen; trusted embedding frames it);
 *  - app: /apps/<slug> (inside the UserTasks shell).
 */
export interface AppLinks {
  friendly_url: string
  embed_url: string
  app_url: string
  /** The workspace address origin, when it has one. */
  workspace_url: string | null
}

export function appLinks(input: { slug: string; workspaceUrl: string | null; mainOrigin: string; workspaceSlug: string | null }): AppLinks {
  const origin = (input.workspaceUrl ?? input.mainOrigin).replace(/\/+$/, '')
  const slug = encodeURIComponent(input.slug)
  const org = !input.workspaceUrl && input.workspaceSlug ? `?org=${encodeURIComponent(input.workspaceSlug)}` : ''
  return {
    friendly_url: `${origin}/app/${slug}${org}`,
    embed_url: `${origin}/embed/apps/${slug}${org}`,
    app_url: `${origin}/apps/${slug}${org}`,
    workspace_url: input.workspaceUrl,
  }
}
