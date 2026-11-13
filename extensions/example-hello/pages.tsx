/**
 * Hello — example extension, custom pages (/x/example-hello/…). React
 * server components rendered inside the app shell; they use only core UI
 * from the SDK, so they follow the workspace theme.
 */
import { definePages, type ExtensionPageProps } from '@user-tasks/extension-sdk'
import { Card, EmptyState, ExtensionActionButton, ExtensionActionForm, PageHeader, StatCard, StatGrid } from '@user-tasks/extension-sdk/ui'

const TABLE = 'ext_example_hello__greetings'

async function recent(ctx: ExtensionPageProps['ctx']) {
  const { data } = await ctx.db.from(TABLE).select('id, name, greeting, source, created_at').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).limit(20)
  return (data ?? []) as Array<{ id: string; name: string; greeting: string; source: string; created_at: string }>
}

async function HelloHome({ ctx, extensionId }: ExtensionPageProps) {
  const greetings = await recent(ctx)
  const config = await ctx.config.get()
  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <PageHeader
        title="Hello"
        description={`Greetings in this workspace, starting with "${String(config.greeting_word ?? 'Hello')}". An example extension page.`}
        actions={<ExtensionActionButton extensionId={extensionId} action="say_hello" label="Say hello to the team" variant="primary" />}
      />
      <StatGrid>
        <StatCard label="Greetings shown" value={greetings.length} />
        <StatCard label="Sources" value={new Set(greetings.map((g) => g.source)).size} />
      </StatGrid>
      {greetings.length === 0 ? (
        <EmptyState title="No greetings yet" description="Send one with the button above, the Say Hello workflow step, the API or the MCP tool." />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border-subtle">
            {greetings.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-ui text-fg">{g.greeting}</span>
                <span className="text-xs text-fg-muted">{g.source} · {new Date(g.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function NewGreeting({ extensionId }: ExtensionPageProps) {
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <PageHeader title="New greeting" breadcrumbs={[{ label: 'Hello', href: `/x/${extensionId}` }]} />
      <Card>
        <ExtensionActionForm extensionId={extensionId} action="create_greeting" submitLabel="Send greeting" fields={[{ name: 'name', label: 'Name', required: true, placeholder: 'Ada' }]} />
      </Card>
    </div>
  )
}

async function Digest({ ctx }: ExtensionPageProps) {
  const greetings = await recent(ctx)
  const byName = new Map<string, number>()
  for (const g of greetings) byName.set(g.name, (byName.get(g.name) ?? 0) + 1)
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <PageHeader title="Greeting digest" description="Who was greeted most recently (example page gated by a workspace setting and a licence feature)." />
      <Card>
        {byName.size === 0 ? <p className="text-ui text-fg-muted">Nothing to report.</p> : (
          <ul className="space-y-1">{[...byName].map(([name, count]) => <li key={name} className="text-ui text-fg">{name}: {count}</li>)}</ul>
        )}
      </Card>
    </div>
  )
}

export default definePages({ '': HelloHome, new: NewGreeting, digest: Digest })
