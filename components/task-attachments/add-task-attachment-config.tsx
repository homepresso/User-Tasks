"use client"

import { VariableInput } from "@/components/automations/variable-input"
import { DEFAULT_ATTACHMENT_TYPES } from "@/lib/task-attachments"

/**
 * Settings of the "Add Task Attachment" workflow step (node-config-panel):
 * the file, the task, and the attachment's name / type / description.
 * Every value takes {{variables}}.
 */
export function AddTaskAttachmentConfig({ config, onUpdate, extraVariables }: {
  config: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- node config
  onUpdate: (key: string, value: unknown) => void
  extraVariables?: { name: string; group: string; label?: string }[]
}) {
  const row = (key: string, label: string, placeholder: string, help?: string, multiline = false) => (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-fg">{label}</label>
      <VariableInput value={String(config[key] ?? "")} onChange={(value) => onUpdate(key, value)} placeholder={placeholder}
        extraVariables={extraVariables} multiline={multiline} rows={2} ariaLabel={label} />
      {help && <p className="text-xs text-fg-muted">{help}</p>}
    </div>
  )
  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()} data-testid="add-task-attachment-config">
      {row("file", "File", "{{doc_file}}", "A file from Download File, an HTTP Request or a document step, {{item}} in a Loop, a storage:// reference, a URL or base64.")}
      {row("task_id", "Task", "{{user_task_id}}", "A task id or variable. Blank: the task that started the run, else the latest User Task.")}
      {row("name", "Name", "Signed contract", "Blank: the file name.")}
      {row("type", "Type", "Contract", `Free text. Suggested: ${DEFAULT_ATTACHMENT_TYPES.join(", ")}.`)}
      {row("description", "Description", "Generated after approval of {{task.title}}", undefined, true)}
      {row("file_name", "File name", "contract-{{task.id}}.pdf", "Optional: rename the stored file.")}
    </div>
  )
}
