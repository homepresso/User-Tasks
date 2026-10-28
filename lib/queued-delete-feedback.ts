export type DeleteNoticeTone = 'success' | 'warning' | 'error'

export interface DeleteNotice {
  tone: DeleteNoticeTone
  message: string
}

interface BuildQueuedDeleteNoticeOptions {
  queued: number
  total: number
  singular: string
  plural: string
  blockedCount?: number
  blockedLabel?: string
}

export function buildQueuedDeleteNotice({
  queued,
  total,
  singular,
  plural,
  blockedCount = 0,
  blockedLabel,
}: BuildQueuedDeleteNoticeOptions): DeleteNotice {
  const noun = total === 1 ? singular : plural
  if (queued <= 0) {
    return {
      tone: 'warning',
      message: `Nothing was queued for deletion. The selected ${noun} are still in place.`,
    }
  }

  if (queued === total && blockedCount <= 0) {
    return {
      tone: 'success',
      message: `Queued ${queued} ${queued === 1 ? singular : plural} for deletion. They’ll disappear shortly.`,
    }
  }

  if (blockedCount > 0) {
    return {
      tone: 'warning',
      message: `Queued ${queued} of ${total} ${plural} for deletion. ${blockedCount} ${blockedCount === 1 ? singular : plural} ${blockedLabel ?? 'still have linked dependencies'}.`,
    }
  }

  return {
    tone: 'warning',
    message: `Queued ${queued} of ${total} ${plural} for deletion.`,
  }
}
