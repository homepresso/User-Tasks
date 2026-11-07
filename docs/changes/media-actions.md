# Release notes: Media actions (images, audio, video)

Eight new workflow steps work with images, audio and video: transcribe
speech, analyse images and video, blur faces, license plates and sensitive
text, generate images and speech, and trim or convert media. Seven of them
call an AI provider with the workspace's own API key (OpenAI, Google
Gemini, Azure AI Speech, Azure AI Vision, AWS Transcribe + Rekognition,
Deepgram, AssemblyAI, ElevenLabs, Stability AI); Media Utilities runs
FFmpeg on the server. Docs: [Media actions](/docs/workflows/media).

Database migration: `20261126000000_media_jobs.sql` (background media
jobs). See [Migrations](../migrations.md).

## Added

- **Transcribe Audio / Video** (`media_transcribe`): speech to text with
  timed segments, optional speaker labels and word timings, language
  detection or a chosen language, a vocabulary hint, and SRT, VTT, TXT and
  JSON transcript files. Long audio is split into chunks when the provider
  has an upload limit.
- **Analyze Image** (`media_analyze_image`): description, labels, objects
  with boxes, text (OCR with positions), face boxes (never identification)
  and safety categories; a question answered as text or as named fields.
- **Analyze Video** (`media_analyze_video`): summary, scenes with
  timestamps, labels, on-screen text and key frames; whole-video
  understanding with Google Gemini, sampled frames (up to 60) with other
  vision providers.
- **Redact Image** (`media_redact_image`): blur, pixelate or box faces,
  license plates and sensitive text — the same information types as Redact
  Document (IDs, card and bank numbers, dates of birth…), words and
  patterns — or boxes from an earlier step. **Detect only** reports masked
  findings with boxes. PNG and JPEG are processed in JavaScript.
- **Redact Video** (`media_redact_video`): the same across a video, with a
  chosen interval between analysed frames, and sensitive speech bleeped or
  muted (also in audio-only files such as call recordings). A transcript
  from an earlier Transcribe step can be reused.
- **Generate / Edit Image** (`media_generate_image`): images from a prompt
  (1–4), or an edit of an image with an optional mask (OpenAI, Stability
  AI).
- **Text to Speech** (`media_tts`): text to MP3, WAV, Opus, AAC or FLAC in a
  chosen voice (OpenAI, Azure AI Speech, Deepgram, ElevenLabs).
- **Media Utilities** (`media_tools`): media info, extract audio, extract
  frames, thumbnail, trim, convert (MP4, WebM, MOV, GIF and audio formats),
  compress and burn in subtitles — no AI provider.
- **Background runs:** in run mode **Auto**, media longer than
  `MEDIA_INLINE_MAX_SECONDS` (300 s) or a provider job (AssemblyAI, AWS
  Transcribe) runs in the background and the workflow continues when it is
  done. **Inline** and **Background** force one or the other; Save & Test
  always runs inline.
- **Cost estimates:** each step returns `cost` from the providers' list
  prices as of the price table's date ("cost unknown" when there is no
  price); `MEDIA_PRICES_JSON` overrides prices.
- **Designer:** a settings panel per step with a provider picker that lists
  only connections able to do the step and says what the chosen one lacks;
  canvas summaries, validation, data-picker outputs, the Variables panel,
  the node reference and MCP guidance.
- **Agents:** a **Media (images, audio, video)** switch in the agent
  designer with a connection picker gives the agent the tools
  `transcribe_media` and `analyze_image`. They send media to the chosen
  provider and can be put on the approval list.
- **Docs:** an overview with the provider × capability matrix, provider
  setup, one page per step and how-tos (meeting recording → summary
  email, blur faces and ID numbers in photos, redact PII from a support
  call).

## Privacy

- Media is sent only to the provider chosen in the step, only when the step
  runs, with the workspace's key. Data residency follows that provider and
  the region or endpoint configured in the connection.
- Run history never contains media or full transcripts: counts, durations,
  provider, model, file names, a 200-character preview and the cost.
- Redaction findings are masked. Faces are located, never identified.
- Temporary files are deleted when each step finishes.

## Limits

Instance-wide, from the environment (see `.env.example`):

| Variable | Default |
|---|---|
| `MEDIA_MAX_MB` | 100 |
| `MEDIA_MAX_DURATION_SECONDS` | 7200 |
| `MEDIA_INLINE_MAX_SECONDS` | 300 |
| `MEDIA_TIMEOUT_SECONDS` | 120 |
| `MEDIA_JOB_TIMEOUT_SECONDS` | 3600 |
| `MEDIA_MAX_IMAGE_MEGAPIXELS` | 40 |
| `MEDIA_VIDEO_REDACT_MAX_SECONDS` | 600 |
| `MEDIA_FFMPEG_TIMEOUT_SECONDS` | 600 |

Also `FFMPEG_PATH`, `FFPROBE_PATH`, `MEDIA_TOOLS=off`, `MEDIA_TMP_DIR` and
`MEDIA_PRICES_JSON`.

## Deployment

- **Docker:** the image installs FFmpeg (build argument
  `INCLUDE_MEDIA_TOOLS=true`, the default).
- **Vercel:** no FFmpeg. Media Utilities, Redact Video, frame-sampled video
  analysis, chunked long-audio transcription and image formats other than
  PNG and JPEG fail with a clear error; provider-side steps work.
- **Elsewhere:** install `ffmpeg` and `ffprobe`, or set `FFMPEG_PATH` /
  `FFPROBE_PATH`.

## New dependencies

| Package | Version | Licence | Used for |
|---|---|---|---|
| `pngjs` | 7.0.0 | MIT | PNG decoding and encoding (image redaction) |
| `jpeg-js` | 0.4.4 | BSD-3-Clause | JPEG decoding and encoding (image redaction) |

## Known limitations

- **Boxes from Google Gemini** are located by the model and approximate;
  check redactions before relying on them.
- **OpenAI** returns no face or text boxes, so it cannot be used for
  redaction.
- **Redact Video** analyses frames at an interval: a region visible for
  less than the interval can be missed. Videos up to 10 minutes by default.
- **Speech redaction** depends on the transcription: misheard words are
  not bleeped. Review samples.
