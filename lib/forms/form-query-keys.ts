/**
 * Client query keys shared by a form's pages and its designer. The designer
 * invalidates `submittableFormKey(id)` after a save that goes live or a
 * publish, so /fill/<id> and /f/<id> in the same tab never draw the old
 * version (a removed header image still showing).
 */
export const submittableFormKey = (formId: string) => ['form-submittable', formId] as const
