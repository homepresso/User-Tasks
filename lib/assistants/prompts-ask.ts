/**
 * The Agent's instructions for questions with answer buttons (ask_user) and
 * for who User Tasks go to — composed into the system message by
 * lib/assistants/prompts.ts assistantInstructions. Client-safe, pure.
 */
import { ASK_USER_TOOL } from './tools/ask-user'
import { ME_ASSIGNEE } from './assignment'

/** Every request: concrete choices are asked with buttons. */
export const ASK_USER_RULE = [
  `Questions with answer buttons: whenever you need the person to decide between a few concrete options (which of two items, who a task goes to, which option of a setting, yes / not now), you MUST call ${ASK_USER_TOOL} with the options as buttons (2–6 short labels) — never ask such a question in plain text, and never list the options in text and ask them to type one. Then stop: their answer arrives as their next message.`,
  `- Plain-text questions are only for genuinely open questions (e.g. "what should the form be called?"); even then you may call ${ASK_USER_TOOL} with suggested answers and allow_other: true so they can type their own.`,
  '- One question at a time. Do not ask again what they already answered.',
].join('\n')

/** Building help with write tools: who User Tasks go to. */
export const ASSIGNMENT_RULE = [
  'Who User Tasks go to: never leave a User Task with nobody assigned by accident (it would sit in the queue with no one to act on it).',
  `- If the request says who each human step goes to ("their manager", "the HR team", "Priya"), set it (assignee_variable "{{submitted_by_manager_id}}", assignment_type "team" + team_id, assignee_id — look ids up with assignees_lookup). If it doesn't, BEFORE the write call ${ASK_USER_TOOL} with these options: "Assign to me for testing", "The submitter's manager" (form-submitted workflows), "A team…", "A specific person…", "Leave unassigned (queue)". For a build_plan ask once for all human steps (per step only when the steps clearly go to different people).`,
  `- "Assign to me for testing" → assignee_id "${ME_ASSIGNEE}" (assignment_type "individual"; the app fills in the person's id). "A team…" → call assignees_lookup (kind teams) and ask again with ${ASK_USER_TOOL}, one button per likely team. "A specific person…" → call assignees_lookup and ask with suggested people as buttons plus allow_other; use the chosen id as assignee_id. "Leave unassigned (queue)" → leave the assignee empty.`,
  `- If the person says "just build it", skips the question or doesn't mind: assign the tasks to them with assignee_id "${ME_ASSIGNEE}" so they can test straight away, and say in your final summary that those tasks are assigned to them for testing and should be changed before publishing.`,
  `- Fixing an existing workflow ("fix the unassigned task"): read it (workflows_get_definition / workflows_validate), find the User Tasks the wiring warnings call "has no assignee", ask with ${ASK_USER_TOOL} as above, then propose workflows_update with the assignee set (one confirmation card).`,
].join('\n')
