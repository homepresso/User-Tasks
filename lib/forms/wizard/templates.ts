/**
 * The wizard's starting points (step 1, "What are you building?"): a card per
 * template with starter questions and sensible defaults (approval for a
 * request, charts for a survey, one response per person for a registration).
 * People change everything afterwards. Pure and isomorphic.
 */

import type { ApprovalMode, QuestionKind, WizardQuestion, WizardSpecInput, WizardTemplate } from './spec'

export interface WizardTemplateDef {
  id: WizardTemplate
  title: string
  /** One line under the title on the card. */
  blurb: string
  /** Material Symbols icon name. */
  icon: string
  /** Default name when the person hasn't typed one. */
  defaultName: string
  questions: Array<{ kind: QuestionKind; label: string; help?: string; required?: boolean; options?: string[]; rows?: string[]; settings?: WizardQuestion['settings']; score?: { correct: string[] } }>
  approval: ApprovalMode
  multipleResponses: boolean
  layout: 'single' | 'steps' | 'one_at_a_time'
  success: { heading: string; message: string }
}

export const WIZARD_TEMPLATE_DEFS: Record<WizardTemplate, WizardTemplateDef> = {
  request: {
    id: 'request', title: 'Request or application', blurb: 'People ask for something and someone approves it.', icon: 'assignment',
    defaultName: 'Request form',
    questions: [
      { kind: 'short_text', label: 'What do you need?', required: true },
      { kind: 'long_text', label: 'Why do you need it?', help: 'A sentence or two helps the approver decide.', required: true },
      { kind: 'money', label: 'Estimated cost' },
      { kind: 'date', label: 'Needed by' },
      { kind: 'file', label: 'Supporting documents' },
    ],
    approval: 'single', multipleResponses: true, layout: 'single',
    success: { heading: 'Your request was sent', message: 'We will let you know when it has been decided.' },
  },
  survey: {
    id: 'survey', title: 'Survey', blurb: 'Collect opinions and see the results as charts.', icon: 'ballot',
    defaultName: 'Survey',
    questions: [
      { kind: 'rating', label: 'Overall, how satisfied are you?', required: true },
      { kind: 'choice', label: 'How often do you use it?', options: ['Daily', 'Weekly', 'Monthly', 'Rarely'] },
      { kind: 'matrix', label: 'How would you rate us on…', rows: ['Quality', 'Ease of use', 'Support', 'Value for money'], options: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'] },
      { kind: 'ranking', label: 'Put these in order of importance to you', options: ['Price', 'Quality', 'Speed', 'Support'] },
      { kind: 'nps', label: 'How likely are you to recommend us to a friend?', settings: { bands: true } },
      { kind: 'long_text', label: 'Anything else you would like to tell us?' },
    ],
    approval: 'none', multipleResponses: false, layout: 'single',
    success: { heading: 'Thank you for your feedback', message: 'Your answers help us improve.' },
  },
  quiz: {
    id: 'quiz', title: 'Questionnaire or quiz', blurb: 'Ask questions, optionally with right answers and a score.', icon: 'quiz',
    defaultName: 'Quiz',
    questions: [
      { kind: 'short_text', label: 'Your name', required: true },
      { kind: 'choice', label: 'Which of these is a primary colour?', options: ['Green', 'Blue', 'Purple'], required: true, score: { correct: ['Blue'] } },
      { kind: 'yes_no', label: 'Is the sun a star?', required: true, score: { correct: ['Yes'] } },
      { kind: 'slider', label: 'How confident are you in your answers?', settings: { min: 0, max: 100, step: 10, unit: '%', low_label: 'Guessing', high_label: 'Certain' } },
    ],
    approval: 'none', multipleResponses: false, layout: 'one_at_a_time',
    success: { heading: 'All done', message: 'Thanks for taking part.' },
  },
  registration: {
    id: 'registration', title: 'Registration or sign-up', blurb: 'Sign people up for an event, course or list.', icon: 'how_to_reg',
    defaultName: 'Registration',
    questions: [
      { kind: 'short_text', label: 'Full name', required: true },
      { kind: 'email', label: 'Email', required: true },
      { kind: 'phone', label: 'Phone' },
      { kind: 'choice', label: 'Which session?', options: ['Morning', 'Afternoon'], required: true },
      { kind: 'long_text', label: 'Dietary or access needs' },
    ],
    approval: 'none', multipleResponses: false, layout: 'single',
    success: { heading: "You're registered", message: 'We look forward to seeing you.' },
  },
  feedback: {
    id: 'feedback', title: 'Feedback', blurb: 'A quick way for people to tell you what they think.', icon: 'reviews',
    defaultName: 'Feedback',
    questions: [
      { kind: 'csat', label: 'How was your experience?', required: true },
      { kind: 'likert', label: 'It was easy to get what I needed', options: ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'] },
      { kind: 'long_text', label: 'What went well?' },
      { kind: 'long_text', label: 'What could be better?' },
      { kind: 'yes_no', label: 'May we contact you about your feedback?' },
      { kind: 'email', label: 'Your email' },
    ],
    approval: 'none', multipleResponses: true, layout: 'single',
    success: { heading: 'Thanks for your feedback', message: 'We read every response.' },
  },
  incident: {
    id: 'incident', title: 'Incident or report', blurb: 'Report something that happened so it gets looked at.', icon: 'report',
    defaultName: 'Incident report',
    questions: [
      { kind: 'short_text', label: 'What happened?', required: true },
      { kind: 'date', label: 'When did it happen?', required: true },
      { kind: 'short_text', label: 'Where did it happen?' },
      { kind: 'choice', label: 'How serious is it?', options: ['Low', 'Medium', 'High', 'Critical'], required: true },
      { kind: 'long_text', label: 'Describe it in detail', required: true },
      { kind: 'file', label: 'Photos or documents' },
    ],
    approval: 'team', multipleResponses: true, layout: 'single',
    success: { heading: 'Thanks, your report was sent', message: 'Someone will look at it soon.' },
  },
  blank: {
    id: 'blank', title: 'Start from scratch', blurb: 'An empty form: add your own questions.', icon: 'add_notes',
    defaultName: 'New form',
    questions: [{ kind: 'short_text', label: 'Your first question', required: false }],
    approval: 'none', multipleResponses: true, layout: 'single',
    success: { heading: 'Thank you — your response was submitted', message: '' },
  },
}

export const WIZARD_TEMPLATE_ORDER: WizardTemplate[] = ['request', 'survey', 'quiz', 'registration', 'feedback', 'incident', 'blank']

/**
 * A fresh spec from a template. Approval modes that need a person or team the
 * template can't know (single, team) start as "none" with the template's
 * choice remembered in `suggestedApproval`, so the wizard can pre-select it.
 */
export function specFromTemplate(template: WizardTemplate, name?: string): { spec: WizardSpecInput; suggestedApproval: ApprovalMode } {
  const def = WIZARD_TEMPLATE_DEFS[template]
  let n = 0
  return {
    suggestedApproval: def.approval,
    spec: {
      version: 1,
      template,
      name: name?.trim() || def.defaultName,
      questions: def.questions.map((q) => ({
        id: `q_${template.slice(0, 3)}${++n}`,
        kind: q.kind,
        label: q.label,
        ...(q.help ? { help: q.help } : {}),
        ...(q.required ? { required: true } : {}),
        ...(q.options ? { options: [...q.options] } : {}),
        ...(q.rows ? { rows: [...q.rows] } : {}),
        ...(q.settings ? { settings: { ...q.settings } } : {}),
        ...(q.score ? { score: { correct: [...q.score.correct] } } : {}),
      })),
      look: { theme: { kind: 'workspace' }, header: { show: true, logo: true }, layout: def.layout, success: { heading: def.success.heading, message: def.success.message || undefined } },
      audience: { internal: true, who: 'everyone', role_ids: [], team_ids: [], show_in_menu: true, public_link: false, multiple_responses: def.multipleResponses },
      approval: { mode: 'none', stages: [], notify_requester: true, due_days: 3 },
      results: { charts: true, role_ids: [], team_ids: [] },
    },
  }
}
