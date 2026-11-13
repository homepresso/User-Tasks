/**
 * `@user-tasks/extension-sdk/ui` — core UI for extension custom pages.
 * Pages render inside the app shell with these components only (no
 * extension CSS, no remote assets), so they follow every workspace theme
 * and contrast preset.
 */

export { Card, CardHeader, CardTitle } from '@/components/ui/card'
export { Button } from '@/components/ui/button'
export { PageHeader } from '@/components/ui/page-header'
export { EmptyState } from '@/components/ui/empty-state'
export { StatCard, StatGrid } from '@/components/ui/stat-card'
export { InlineNotice } from '@/components/ui/inline-notice'
export { ExtensionActionButton, ExtensionActionForm, type ActionFormField } from '@/components/extensions/action-controls'
