"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, FileInput, Plus } from "lucide-react"
import { usePermissions } from "@/lib/permissions-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CREATE_ACTIONS } from "./create-actions"
import { HeaderFormsPanel, HeaderFormsPanelBody } from "./header-forms-menu"
import { useAvailableFormsState } from "./available-forms-menu"

/**
 * "+ New" in the top bar (docs/design/ui-polish-spec.md §4.2): Task,
 * Workflow, Form, Data table and Report (each by permission), plus "Fill in
 * a form…", which opens the person's available forms (the old header Forms
 * dropdown) under the button.
 */
export function NewMenu() {
  const router = useRouter()
  const { can } = usePermissions()
  const { forms, loading } = useAvailableFormsState()
  const [formsOpen, setFormsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const actions = CREATE_ACTIONS.filter((a) => can(a.requires))
  const canFill = can("forms.submit")
  if (actions.length === 0 && !canFill) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="secondary" size="sm" leadingIcon={<Plus />} trailingIcon={<ChevronDown className="text-fg-muted max-sm:hidden" />} className="max-sm:w-8 max-sm:gap-0 max-sm:px-0" data-new-menu-trigger>
            <span className="max-sm:sr-only">New</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {actions.length > 0 && <DropdownMenuLabel>Create</DropdownMenuLabel>}
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <DropdownMenuItem key={action.id} icon={<Icon />} onSelect={() => router.push(action.href)} data-new-menu-item={action.id}>
                {action.label}
              </DropdownMenuItem>
            )
          })}
          {canFill && (
            <>
              {actions.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                icon={<FileInput />}
                // Opens after the menu has closed and returned focus.
                onSelect={() => setTimeout(() => setFormsOpen(true), 0)}
                data-new-menu-item="fill-form"
              >
                Fill in a form…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {formsOpen && (
        <HeaderFormsPanel
          anchor={triggerRef}
          placement="below-end"
          onClose={() => { setFormsOpen(false); triggerRef.current?.focus() }}
          onDismiss={() => setFormsOpen(false)}
        >
          <HeaderFormsPanelBody forms={forms} loading={loading} onClose={() => { setFormsOpen(false); triggerRef.current?.focus() }} autoFocus />
        </HeaderFormsPanel>
      )}
    </>
  )
}
