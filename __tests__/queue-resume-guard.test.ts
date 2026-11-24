/**
 * Resume jobs are recognised by their trigger type (task_resume /
 * delay_resume, set by the engine), never by keys in their data: a webhook
 * payload, form submission or API start could carry `_task_resume` or
 * `_resume_run_id` and would otherwise steer the job into resuming a paused
 * run with attacker-chosen data.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { RESUME_KEYS, TASK_RESUME_TRIGGER, resumeData } from '@/lib/workflow-queue-processor'
import { RESUME_TRIGGER_TYPE } from '@/lib/workflow-resume-queue'

const RUN = '11111111-2222-3333-4444-555555555555'

describe('queue resume guard', () => {
  it('uses the same task resume trigger type as the resume queue', () => {
    expect(TASK_RESUME_TRIGGER).toBe(RESUME_TRIGGER_TYPE)
  })

  it('honours resume data only on engine resume jobs', () => {
    expect(resumeData('task_resume', { _task_resume: { run_id: RUN } }).taskResume).toEqual({ run_id: RUN })
    expect(resumeData('delay_resume', { _resume_run_id: RUN }).delayRunId).toBe(RUN)
  })

  it('ignores the same keys on webhook, form, API and other jobs', () => {
    for (const type of ['webhook', 'form_submission', 'api', 'manual', 'schedule', 'data_table', null, undefined]) {
      const r = resumeData(type, { _task_resume: { run_id: RUN, outcome: 'approved' }, _resume_run_id: RUN, _resume_event_id: 'e' })
      expect(r, String(type)).toEqual({ taskResume: null, delayRunId: null })
    }
    // A task_resume job with a delay key (or the reverse) is not cross-wired.
    expect(resumeData('task_resume', { _resume_run_id: RUN })).toEqual({ taskResume: null, delayRunId: null })
    expect(resumeData('delay_resume', { _task_resume: { run_id: RUN } })).toEqual({ taskResume: null, delayRunId: null })
  })

  it('runJob dispatches on resumeData and strips the reserved keys from every other job', () => {
    const src = readFileSync(path.resolve(__dirname, '../lib/workflow-queue-processor.ts'), 'utf8')
    const body = src.slice(src.indexOf('export async function runJob'))
    expect(body).toContain('resumeData(job.trigger_type, triggerData)')
    expect(body).toMatch(/for \(const key of RESUME_KEYS\) delete triggerData\[key\]/)
    // No dispatch on raw keys any more.
    expect(body).not.toMatch(/triggerData\?\._task_resume\s*\n?\s*\?/)
    expect(RESUME_KEYS).toEqual(['_task_resume', '_resume_run_id', '_resume_event_id', '_resume_attempt'])
  })
})
