'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImportApiDialog } from './import-api-dialog'

export function ImportApiButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
        <Upload size={14} /> Import API
      </Button>
      <ImportApiDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
