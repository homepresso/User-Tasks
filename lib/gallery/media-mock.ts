/**
 * Mock media AI provider for gallery verification (Google Gemini API shape):
 * answers generateContent for the media steps — transcription, image
 * analysis with face / plate / text boxes, video analysis and structured
 * answers — with canned content that matches the synthetic sample media in
 * gallery/samples/ (illustrated people, specimen numbers, tones instead of
 * speech).
 *
 * Images are recognised by their size (each sample has its own), so the
 * boxes land on the face, plate and text the picture really shows. A
 * package picks its transcript and structured answers in gallery.json
 * (`verify_mocks.media`). Nothing here is real data: SSN 078-05-1120 is the
 * well-known specimen number and 4111 1111 1111 1111 a test card.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- free-form provider JSON */

export interface MediaMockOptions {
  /** Which canned recording the transcription returns. */
  transcript?: keyof typeof TRANSCRIPTS
  /** Structured answers (Analyze Image / Video with fields) by field name. */
  answers?: Record<string, unknown>
  /** Image labels (Analyze Image) instead of the layout's. */
  labels?: string[]
  /** Description instead of the layout's. */
  description?: string
}

type Px = { left: number; top: number; width: number; height: number }
interface Layout { width: number; height: number; description: string; labels: string[]; faces: Px[]; plates: Px[]; lines: Array<{ text: string; px: Px }>; objects?: Array<{ label: string; px: Px }> }

/** The sample pictures, keyed by size (see gallery/samples and its generator notes). */
const LAYOUTS: Layout[] = [
  {
    width: 640, height: 400,
    description: 'An illustrated specimen driver license: a blocky head-and-shoulders photo on the left and printed holder details on the right.',
    labels: ['identity document', 'driver license', 'text', 'face'],
    faces: [{ left: 72, top: 96, width: 96, height: 116 }],
    plates: [],
    lines: [
      { text: 'SAMPLE STATE DRIVER LICENSE', px: { left: 24, top: 14, width: 390, height: 30 } },
      { text: 'NAME ALEX SAMPLE', px: { left: 256, top: 108, width: 232, height: 28 } },
      { text: 'DOB 1980-07-04', px: { left: 256, top: 158, width: 192, height: 28 } },
      { text: 'SSN 078-05-1120', px: { left: 256, top: 214, width: 238, height: 34 } },
      { text: 'SPECIMEN - NOT A REAL DOCUMENT', px: { left: 256, top: 328, width: 275, height: 20 } },
    ],
  },
  {
    width: 480, height: 480,
    description: 'An illustrated selfie: one blocky face and shoulders against a plain wall.',
    labels: ['person', 'face', 'portrait'],
    faces: [{ left: 176, top: 108, width: 128, height: 158 }],
    plates: [],
    lines: [{ text: 'SAMPLE SELFIE - ILLUSTRATION', px: { left: 118, top: 436, width: 262, height: 22 } }],
  },
  {
    width: 800, height: 500,
    description: 'An illustrated blue car parked on a street with a dented, scratched driver door; a bystander stands on the left.',
    labels: ['car', 'vehicle', 'dent', 'scratch', 'door panel', 'person'],
    faces: [{ left: 36, top: 142, width: 80, height: 96 }],
    plates: [{ left: 516, top: 316, width: 138, height: 44 }],
    lines: [
      { text: 'SMPL 01', px: { left: 516, top: 316, width: 138, height: 44 } },
      { text: 'SAMPLE PHOTO - ILLUSTRATION', px: { left: 24, top: 458, width: 290, height: 22 } },
    ],
    objects: [{ label: 'car', px: { left: 150, top: 150, width: 540, height: 250 } }, { label: 'dent', px: { left: 360, top: 250, width: 110, height: 46 } }],
  },
  {
    width: 640, height: 360,
    description: 'An illustrated street scene: a person on the left, a case note on a board with a printed number, and a red car with a license plate on the right.',
    labels: ['person', 'car', 'street', 'sign', 'text'],
    faces: [{ left: 56, top: 82, width: 80, height: 92 }],
    plates: [{ left: 466, top: 276, width: 108, height: 36 }],
    lines: [
      { text: 'CASE NOTE', px: { left: 240, top: 44, width: 75, height: 16 } },
      { text: 'SSN 078-05-1120', px: { left: 240, top: 60, width: 198, height: 30 } },
      { text: 'SMPL 42', px: { left: 466, top: 276, width: 108, height: 36 } },
    ],
    objects: [{ label: 'car', px: { left: 380, top: 180, width: 230, height: 130 } }, { label: 'person', px: { left: 45, top: 86, width: 100, height: 234 } }],
  },
  {
    width: 512, height: 512,
    description: 'A flat illustration of coloured squares on a yellow card with the words SAMPLE UPLOAD; no people.',
    labels: ['illustration', 'graphic design', 'shapes', 'text'],
    faces: [],
    plates: [],
    lines: [{ text: 'SAMPLE UPLOAD', px: { left: 150, top: 428, width: 214, height: 32 } }],
  },
]

/** Canned recordings (times in seconds; each fits its sample's length). */
export const TRANSCRIPTS = {
  meeting: [
    { start: 0.4, end: 3.6, speaker: 'Speaker 1', text: 'Thanks everyone, this is the weekly operations review.' },
    { start: 3.9, end: 7.2, speaker: 'Speaker 2', text: 'We agreed to move the warehouse cutover to the fourteenth.' },
    { start: 7.5, end: 10.4, speaker: 'Speaker 1', text: 'Jordan will update the rollout plan by Friday.' },
    { start: 10.7, end: 13.5, speaker: 'Speaker 3', text: 'I will send the supplier the revised forecast next week.' },
  ],
  call: [
    { start: 0.3, end: 2.6, speaker: 'Speaker 1', text: 'Thank you for calling support, how can I help?' },
    { start: 2.9, end: 6.4, speaker: 'Speaker 2', text: 'I want to update my card, the number is 4111 1111 1111 1111.' },
    { start: 6.7, end: 8.8, speaker: 'Speaker 1', text: 'Thanks, can you confirm your social security number?' },
    { start: 9.0, end: 11.6, speaker: 'Speaker 2', text: 'It is 078-05-1120.' },
  ],
  interview: [
    { start: 0.3, end: 2.8, speaker: 'Speaker 1', text: 'Please state what you saw for the record.' },
    { start: 3.0, end: 5.6, speaker: 'Speaker 2', text: 'I saw the red car stop by the case board.' },
    { start: 5.8, end: 7.9, speaker: 'Speaker 2', text: 'My number is 078-05-1120 if you need it.' },
  ],
} as const

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** Width and height of a PNG or JPEG (null for anything else). */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      const length = bytes.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) }
      i += 2 + length
    }
  }
  return null
}

function layoutFor(size: { width: number; height: number } | null): Layout {
  if (!size) return LAYOUTS[0]
  const ratio = size.width / size.height
  return LAYOUTS.find((l) => l.width === size.width && l.height === size.height)
    ?? LAYOUTS.find((l) => Math.abs(l.width / l.height - ratio) < 0.02)
    ?? LAYOUTS[0]
}

/** Pixels → Gemini box_2d ([ymin, xmin, ymax, xmax] in 0–1000). */
function box2d(px: Px, layout: Layout): number[] {
  const r = (v: number) => Math.round(v * 1000)
  return [r(px.top / layout.height), r(px.left / layout.width), r((px.top + px.height) / layout.height), r((px.left + px.width) / layout.width)]
}

function genericAnswer(schema: any, answers: Record<string, unknown>): unknown {
  if (!schema || schema.type !== 'object') return typeof answers.answer === 'string' ? answers.answer : 'This is a synthetic sample: an illustration with no real people or documents.'
  const out: Record<string, unknown> = {}
  for (const [key, prop] of Object.entries<any>(schema.properties ?? {})) {
    if (key in answers) { out[key] = answers[key]; continue }
    out[key] = prop?.type === 'number' || prop?.type === 'integer' ? 0.1 : prop?.type === 'boolean' ? false : prop?.type === 'array' ? [] : prop?.type === 'object' ? {} : `sample ${key}`
  }
  return out
}

/** The first inline media of a generateContent request. */
function inlineMedia(body: any): { mime: string; bytes: Buffer } | null {
  for (const content of body?.contents ?? []) {
    for (const part of content?.parts ?? []) {
      const data = part?.inline_data ?? part?.inlineData
      if (data?.data) return { mime: String(data.mime_type ?? data.mimeType ?? ''), bytes: Buffer.from(String(data.data), 'base64') }
    }
  }
  return null
}

/** A Gemini generateContent answer for one media step request. */
export function geminiMockAnswer(body: any, options: MediaMockOptions = {}): Record<string, unknown> {
  const schema = body?.generationConfig?.responseJsonSchema ?? body?.generationConfig?.responseSchema ?? {}
  const props = schema.properties ?? {}
  const answers = options.answers ?? {}
  let data: Record<string, unknown> = {}
  if (props.segments) {
    const segments = TRANSCRIPTS[options.transcript ?? 'interview'] ?? TRANSCRIPTS.interview
    data = { language: 'en', segments: segments.map((s) => ({ start: mmss(s.start), end: mmss(s.end), speaker: s.speaker, text: s.text })) }
  } else if (props.scenes || props.summary) {
    data = {
      summary: options.description ?? 'An illustrated sample clip: a person stands near a red car and a case note board; nothing unsafe happens.',
      scenes: [{ start: '00:00', end: '00:04', title: 'Arrival', description: 'The camera faces the street.' }, { start: '00:04', end: '00:08', title: 'Case board', description: 'The case note board and the car stay in view.' }],
      labels: [{ name: 'person', confidence: 0.94, times: ['00:00'] }, { name: 'car', confidence: 0.92, times: ['00:00'] }],
      text: [{ text: 'BODY CAM 01 SAMPLE', start: '00:00', end: '00:08' }],
    }
  } else {
    const media = inlineMedia(body)
    const layout = layoutFor(media ? imageSize(media.bytes) : null)
    if (props.description) data.description = options.description ?? layout.description
    if (props.labels) data.labels = (options.labels ?? layout.labels).map((name, i) => ({ name, confidence: Math.round((0.97 - i * 0.04) * 100) / 100 }))
    if (props.objects) {
      data.objects = [
        ...(layout.objects ?? []).map((o) => ({ label: o.label, box_2d: box2d(o.px, layout), confidence: 0.9 })),
        ...layout.plates.map((px) => ({ label: 'license plate', box_2d: box2d(px, layout), confidence: 0.93 })),
      ]
    }
    if (props.text_lines) data.text_lines = layout.lines.map((l) => ({ text: l.text, box_2d: box2d(l.px, layout) }))
    if (props.faces) data.faces = layout.faces.map((px) => ({ box_2d: box2d(px, layout), confidence: 0.95 }))
  }
  if (props.answer) data.answer = genericAnswer(props.answer, answers)
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 180, totalTokenCount: 1380 },
    modelVersion: 'gallery-mock',
  }
}

/** Is this request path a Gemini media call the mock answers? */
export function isGeminiGenerate(method: string, path: string): boolean {
  return method === 'POST' && /\/v1beta\/models\/[^/]+:generateContent$/.test(path)
}
