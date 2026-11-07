'use client'

import type { AnonymousFormPage } from '@/lib/services/anonymous-forms'
import { EmbedFrame } from './embed-frame'
import { StandaloneForm } from './standalone-form'

/** A public form link's page body: the form alone (no favourite / draft icons, no Home or menus). `embed`: the embedded look (lib/forms/embed.ts). */
export function AnonymousFormView({ token, page, query, embed = false }: { token: string; page: AnonymousFormPage; query?: Record<string, string | string[] | undefined>; embed?: boolean }) {
  return (
    <EmbedFrame embed={embed}>
      <div className={embed ? undefined : 'py-2'} data-anonymous-form>
        <StandaloneForm formId={page.form.id} query={query} anonymous={{ token, page }} surface="standalone" embed={embed} />
      </div>
    </EmbedFrame>
  )
}
