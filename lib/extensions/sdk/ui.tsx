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
export { Badge, StatusPill, Tag, type Tone } from '@/components/ui/badge'
/** Entity tables (one table look everywhere): Table > THead/TBody > TR > TH/TD, with column presets (`col`). */
export { Table, THead, TBody, TR, TH, TD, Truncate, TableEmpty } from '@/components/ui/table'
export { ExtensionActionButton, ExtensionActionForm, type ActionFormField } from '@/components/extensions/action-controls'
/** A generated API reference page (model: ApiReferenceDoc in @user-tasks/extension-sdk). */
export { ApiReference } from '@/components/extensions/api-reference'
