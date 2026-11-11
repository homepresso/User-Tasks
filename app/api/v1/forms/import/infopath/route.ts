import { apiRoute } from '@/lib/api/route'
import { importInfoPathEndpoint } from '@/lib/api-schemas/forms'
import { INFOPATH_LIMITS } from '@/lib/infopath/archive'
import { analyzeInfoPathFile, decodeBase64File, importInfoPathFile } from '@/lib/services/infopath-import'

// Analysing a large form template takes a few seconds.
export const maxDuration = 60

/**
 * POST /api/v1/forms/import/infopath — analyse (dry_run) or import an
 * InfoPath form template. JSON (file_base64) or multipart/form-data (file).
 */
export const POST = apiRoute(importInfoPathEndpoint, async ({ ctx, body }) => {
  const bytes = decodeBase64File(body.file_base64, INFOPATH_LIMITS.maxInputBytes)
  const options = {
    mode: body.mode, views: body.views, name: body.name, tag: body.tag, existing: body.existing,
    create_table: body.create_table, available_in_menu: body.available_in_menu,
  }
  const fileName = body.file_name || 'form.xsn'
  return body.dry_run ? analyzeInfoPathFile(ctx, bytes, fileName, options) : importInfoPathFile(ctx, bytes, fileName, options)
})
