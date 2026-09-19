# ElevenLabs

Set `ELEVENLABS_API_KEY` and configure an `elevenlabs` connection. Keys need permissions for the endpoints used. This plugin uses the fixed `https://api.elevenlabs.io` origin.

## Actions

| Resource | Actions |
|---|---|
| Models | `models.list` |
| Voices | `voices.list`, `voices.get`, `voices.clone`, `voices.delete`, `voices.update`, `voices.settings.get`, `voices.settings.update` |
| Speech | `speech.create` (optional timestamps), `speech.convert` |
| Dialogue | `dialogue.create` |
| Transcription | `transcription.create` |
| Music and sound | `music.create`, `sound.create` |
| Cleanup | `audio.isolate` |
| Recovery | `history.list`, `history.get`, `history.download` |
| Pronunciation | `pronunciationDictionaries.list`, `pronunciationDictionaries.create` |

## Generation

Audio returns `audio.path`, `audio.mimeType`, `audio.byteLength`, `outputFormat`, provider request/song/billing headers when present, and a file-delivery note. Deliver the path with the host's file-sending tool; no audio base64 is returned.

- Speech and dialogue: MP3, WAV, raw PCM, or Opus; default `mp3_44100_128`.
- Music and sound: MP3, raw PCM, or Opus. These endpoints do not advertise WAV.
- Music defaults to `auto`, selecting the model's native MP3 format; 48 kHz MP3 options are also available.
- PCM files have no WAV header; retain `outputFormat` for sample rate and consult the endpoint's channel layout. Opus output is saved as Ogg. No local transcoding is performed.
- Isolation and history retrieval preserve the downloaded response format. History's original generation format is not a guarantee of the download format. Ambiguous downloads without an audio Content-Type are rejected rather than mislabeled.
- Higher-quality formats may require a paid subscription tier.

### Speech, timestamps, and pronunciation

Use `voices.list` to select a voice ID. Speech defaults to `eleven_multilingual_v2`; voice conversion defaults to `eleven_multilingual_sts_v2`. `languageCode` is unsupported by Multilingual v2; select a compatible model such as Flash or Turbo when using it.

```js
return await elevenlabs.speech.create({
  voiceId: "your-voice-id",
  text: "Welcome to Runline.",
  outputFormat: "wav_44100",
  timestamps: true,
  seed: 42,
  normalization: "auto",
  pronunciationDictionaries: [{ pronunciation_dictionary_id: "your-dictionary-id" }],
});
```

With `timestamps: true`, the audio is saved and character-level `alignment` / `normalizedAlignment` arrays are returned. Speech supports `previousText`, `nextText`, `previousRequestIds`, and `nextRequestIds` for continuity, plus `languageNormalization` (currently Japanese). Request-ID continuity takes precedence over neighboring text on the provider. Dictionary locators and neighboring request-ID arrays accept at most three entries. Seeds are best-effort, not a reproducibility guarantee.

`dialogue.create` accepts `inputs: [{ text, voiceId }]`, defaults to `eleven_v3`, and supports pronunciation dictionaries, normalization, seed, and stability. Runline limits each dialogue request to 10 unique voices and 2,000 total text characters for reliable generation.

### Music composition

Use either a prompt with explicit `durationMs`, or a model-specific `compositionPlan`. Do not combine them. Plans use provider field names and explicit durations; Runline caps total duration at 600,000 ms.

```js
return await elevenlabs.music.create({
  prompt: "Quiet ambient piano with soft strings, no drums",
  durationMs: 15000,
  instrumental: true,
});
```

```js
return await elevenlabs.music.create({
  model: "music_v2",
  compositionPlan: {
    chunks: [{
      text: "[Instrumental Intro]",
      duration_ms: 15000,
      positive_styles: ["ambient", "warm piano", "soft strings", "gentle", "spacious", "cinematic"],
    }],
  },
  seed: 42,
});
```

`music_v1` uses `positive_global_styles`, `negative_global_styles`, and `sections`, each containing `section_name`, `positive_local_styles`, `negative_local_styles`, `duration_ms`, and lyric `lines`. `music_v2` / `music_v2_5` use `chunks`. Plan seeds are supported; prompt generation cannot use a seed. `instrumental` is prompt-only. `respectSectionsDurations` applies only to v1 plans. Inpainting and audio-reference chunks are not exposed.

## Transcription and cleanup

`transcription.create` defaults to `scribe_v2`. Supply exactly one of `filePath` or `sourceUrl`. Remote HTTPS sources are fetched by ElevenLabs, never by this host. The action supports:

- `timestampsGranularity`: `none`, `word`, or `character`.
- `languageCode`, `diarize`, `numSpeakers` (up to 32), and `tagAudioEvents`.
- `keyterms`: up to 1,000 terms, each under 50 characters and at most five words. Adds a **20% surcharge**; over 100 terms imposes a **20-second minimum billable duration**.
- `multiChannel`: up to five provider-supported channels. **Each channel is billed for the full audio duration.** `channelOutput: "separate"` returns `transcripts[]`; `"combined"` requires timestamps and returns one merged transcript.

`audio.isolate` removes background noise from a local recording. Both operations are billed. Inputs must be local regular files of at most 25 MiB where local files are used; hosted sources follow the provider's own limits.

## Recovery and management

- `history.list` covers the provider's **speech history**, with source filters `TTS`, `STS`, and `Flows`. It is not a universal music or sound archive. Pass `last_history_item_id` as `cursor` while `has_more` is true.
- `history.download` retrieves existing audio without regenerating or submitting a generation POST. It writes locally, so its access classification is `write`.
- Zero-retention requests are unavailable in history.
- `voices.list` uses `next_page_token`; pronunciation dictionary listing uses `next_cursor`.
- Clone and edit only voices you own or have permission to use. Clone responses retain the provider's verification requirement.
- `voices.settings.update` follows provider replacement/default semantics. Read current settings and construct complete settings when preserving other values; omitted fields may reset to provider defaults.
- `voices.update` requires a name and can change description/labels or add authorized samples.
- Pronunciation dictionaries support alias and phoneme rules. Phoneme support depends on the synthesis model. Creation returns `id` and `version_id` for use in synthesis locators.

## Limits and safety

- No automatic request retries. After a timeout or file-write failure, check provider history where supported before repeating billed work.
- Shared redirect-refusing authentication, fixed API origin, bounded readers, and exclusive private file creation (`0600`).
- Local inputs: nonempty regular files, up to 25 MiB each; cloning/editing accepts up to 10 samples. These are Runline limits, not service-wide limits.
- Responses: up to 100 MiB for binary audio, 8 MiB for ordinary JSON, 32 MiB for timestamped audio JSON (including base64 and alignment).
- Generation/transcription HTTP requests default to 300 seconds, configurable up to one hour. Metadata and voice management requests default to 60 seconds. History recovery uses one audio GET with the generation-style deadline.
- The host execution timeout is independent; configure it for long generation calls. Client timeouts do not cancel provider work.
- `saveDir` must already exist; default is the OS temp directory.

## Deferred

Realtime WebSockets, playback streaming, agents, dubbing, professional cloning, voice design, music fine-tuning/inpainting, webhook receiving/management, and transcription entity detection/redaction remain outside this creative-audio scope. No blanket claim of support for the entire ElevenLabs platform.

## References

[API reference](https://elevenlabs.io/docs/api-reference/introduction), [OpenAPI schema](https://api.elevenlabs.io/openapi.json), and [official n8n baseline](https://github.com/elevenlabs/elevenlabs-n8n). Implementation uses Runline schemas and shared transport/file helpers, not n8n dependencies. Authenticated live validation requires a key and an approved generation budget.
