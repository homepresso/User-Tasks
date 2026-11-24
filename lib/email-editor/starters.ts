/**
 * Starter email templates for the editor: notification, approval request,
 * digest / summary and welcome. Built from Design blocks (so they open in
 * the Design tab), theme-neutral by default and branded with the
 * workspace's logo / accent / name when the editor knows them. Pure.
 */

import { designToHtml, emptyDesign, newBlockId, type DesignBlock, type DesignSettings, type EmailDesign } from './blocks'
import { htmlToEmailText } from './html-to-text'
import { setPreheader } from './preview'
import type { EmailVariableDeclaration } from './variables'

export interface StarterBranding {
  logoUrl?: string | null
  /** #rrggbb accent (the workspace theme's primary). */
  accent?: string | null
  accentText?: string | null
  workspaceName?: string | null
}

export interface StarterTemplate {
  id: 'notification' | 'approval' | 'digest' | 'welcome'
  name: string
  description: string
  subject: string
  preheader: string
  variables: EmailVariableDeclaration[]
  design: EmailDesign
}

export interface StarterContent {
  name: string
  description: string
  subject: string
  html_body: string
  text_body: string
  variables: EmailVariableDeclaration[]
}

const HEX = /^#[0-9a-f]{6}$/i

function settingsFor(branding: StarterBranding): Partial<DesignSettings> {
  const out: Partial<DesignSettings> = {}
  if (branding.accent && HEX.test(branding.accent)) out.accent = branding.accent.toUpperCase()
  if (branding.accentText && HEX.test(branding.accentText)) out.accentText = branding.accentText.toUpperCase()
  return out
}

function header(branding: StarterBranding): DesignBlock {
  return { id: newBlockId(), type: 'header', ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}), wordmark: branding.workspaceName?.trim() || 'Your workspace', align: 'left' }
}

function footer(branding: StarterBranding): DesignBlock {
  const name = branding.workspaceName?.trim() || 'your workspace'
  return { id: newBlockId(), type: 'footer', html: `<p>Sent by ${escapeText(name)} with UserTasks · {{current_year}}</p><p>If the button does not work, open <a href="{{task_url}}">{{task_url}}</a></p>` }
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function starterTemplates(branding: StarterBranding = {}): StarterTemplate[] {
  const settings = settingsFor(branding)
  const design = (blocks: DesignBlock[]): EmailDesign => ({ ...emptyDesign(settings), blocks })
  const id = newBlockId
  return [
    {
      id: 'notification',
      name: 'Task notification',
      description: 'Tells the assignee a task is waiting, with the instructions and a link.',
      subject: 'New task: {{user_task_title}}',
      preheader: 'A task is waiting for you in UserTasks',
      variables: [],
      design: design([
        header(branding),
        { id: id(), type: 'heading', text: '{{user_task_title}}', level: 1 },
        { id: id(), type: 'text', html: '<p>{{user_task_description_html}}</p>' },
        { id: id(), type: 'button', label: 'Open task', url: '{{task_url}}', align: 'left' },
        { id: id(), type: 'spacer', height: 8 },
        footer(branding),
      ]),
    },
    {
      id: 'approval',
      name: 'Approval request',
      description: 'Asks for a decision with the key facts and Approve / Review buttons.',
      subject: 'Approval needed: {{request_title}}',
      preheader: '{{requester_name}} is waiting for your decision',
      variables: [
        { name: 'request_title', label: 'Request title', type: 'text', sample: 'Laptop purchase for the design team', required: true },
        { name: 'requester_name', label: 'Requester', type: 'text', sample: 'Jordan Lee' },
        { name: 'amount', label: 'Amount', type: 'text', sample: '$2,400.00', description: 'Formatted amount (USD)' },
        { name: 'due_date', label: 'Decision needed by', type: 'date', sample: 'Friday, December 4' },
      ],
      design: design([
        header(branding),
        { id: id(), type: 'heading', text: 'Approval needed: {{request_title}}', level: 1 },
        { id: id(), type: 'text', html: '<p><strong>{{requester_name}}</strong> has asked for your approval. Please review the request and decide by <strong>{{due_date}}</strong>.</p>' },
        { id: id(), type: 'columns', left: '<p><strong>Amount</strong><br>{{amount}}</p>', right: '<p><strong>Requested by</strong><br>{{requester_name}}</p>' },
        { id: id(), type: 'button', label: 'Review and decide', url: '{{task_url}}', align: 'left' },
        { id: id(), type: 'text', html: '<p>You can approve, reject or return the request with a comment from the task.</p>' },
        { id: id(), type: 'divider' },
        footer(branding),
      ]),
    },
    {
      id: 'digest',
      name: 'Digest / summary',
      description: 'A periodic summary with headline numbers and a list of items.',
      subject: 'Your summary for {{period}}',
      preheader: '{{open_count}} open items, {{completed_count}} completed',
      variables: [
        { name: 'period', label: 'Period', type: 'text', sample: 'the week of November 16', required: true },
        { name: 'open_count', label: 'Open items', type: 'number', sample: '12' },
        { name: 'completed_count', label: 'Completed items', type: 'number', sample: '34' },
        { name: 'items_html', label: 'Item list (HTML)', type: 'html', sample: '<ul><li>Laptop purchase — $2,400.00 — awaiting approval</li><li>Vendor onboarding — in review</li></ul>', description: 'A list built by the workflow (e.g. a Text Template step)' },
        { name: 'dashboard_url', label: 'Dashboard link', type: 'url', sample: 'https://app.example.com/home' },
      ],
      design: design([
        header(branding),
        { id: id(), type: 'heading', text: 'Your summary for {{period}}', level: 1 },
        { id: id(), type: 'columns', left: '<p><strong>Open</strong><br>{{open_count}}</p>', right: '<p><strong>Completed</strong><br>{{completed_count}}</p>' },
        { id: id(), type: 'heading', text: 'Highlights', level: 2 },
        { id: id(), type: 'text', html: '<p>{{items_html}}</p>' },
        { id: id(), type: 'button', label: 'Open dashboard', url: '{{dashboard_url}}', align: 'left' },
        footer(branding),
      ]),
    },
    {
      id: 'welcome',
      name: 'Welcome',
      description: 'Greets a new person with next steps.',
      subject: 'Welcome to {{workspace_name}}, {{first_name}}',
      preheader: 'Here is how to get started',
      variables: [
        { name: 'first_name', label: 'First name', type: 'text', sample: 'Alex', required: true },
        { name: 'workspace_name', label: 'Workspace name', type: 'text', sample: branding.workspaceName?.trim() || 'Acme Operations' },
        { name: 'start_url', label: 'Get started link', type: 'url', sample: 'https://app.example.com/tasks' },
      ],
      design: design([
        header(branding),
        { id: id(), type: 'heading', text: 'Welcome, {{first_name}}', level: 1 },
        { id: id(), type: 'text', html: '<p>We are glad to have you in <strong>{{workspace_name}}</strong>. Here is how to get started:</p><ol><li>Open your task list to see what is waiting for you.</li><li>Complete your profile so teammates can find you.</li><li>Turn on notifications for tasks assigned to you.</li></ol>' },
        { id: id(), type: 'button', label: 'Get started', url: '{{start_url}}', align: 'left' },
        footer(branding),
      ]),
    },
  ]
}

/** A starter as template content (HTML with preheader, text part, declarations). */
export function starterContent(starter: StarterTemplate): StarterContent {
  const html = setPreheader(designToHtml(starter.design), starter.preheader)
  return {
    name: starter.name,
    description: starter.description,
    subject: starter.subject,
    html_body: html,
    text_body: htmlToEmailText(html),
    variables: starter.variables,
  }
}
