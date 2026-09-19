# ElevenLabs

Set `ELEVENLABS_API_KEY` and configure an `elevenlabs` connection. Keys need permissions for the endpoints used.

## Actions

- `models.list`: model capabilities.
- `voices.list`: one page of searchable voices; pass `next_page_token` as `cursor` while `has_more` is true.
- `voices.get`, `voices.delete`: voice metadata and deletion.
- `voices.clone`: instant cloning from local samples you own or have permission to use. Preserves the provider's verification requirement in the response.
- `speech.create`: text to speech; defaults to `eleven_multilingual_v2`.
- `speech.convert`: voice conversion; defaults to `eleven_multilingual_sts_v2`.
- `transcription.create`: local audio/video to text with `scribe_v2`, optional diarization.
- `music.create`: prompt-based music, with required `durationMs` and optional `instrumental`.
- `sound.create`: sound effects with `eleven_text_to_sound_v2`.

```js
const voices = await elevenlabs.voices.list({ search: "Rachel", limit: 10 });
return voices;
// Choose the desired voice_id before calling speech.create.
```

```js
return await elevenlabs.music.create({
  prompt: "Quiet ambient piano with soft strings, no drums",
  durationMs: 15000,
  instrumental: true,
});
```

Audio generation returns `{ audio: { path, mimeType, byteLength }, requestId, songId, note }`. IDs are null when the provider omits their headers. Deliver `audio.path` using the host's file-sending tool. Output is MP3; other codecs and music composition plans are not exposed.

## Limits and billing

Generation and transcription consume credits. Voice cloning and deletion modify the account. None of the requests are automatically retried. After a timeout or local write failure, do not blindly repeat billed requests; check provider history first.

- Local input: nonempty regular files, up to 25 MiB each; cloning accepts up to 10 samples.
- Response: up to 100 MiB for audio, 8 MiB for JSON.
- Generation/transcription timeout: 300 seconds by default, configurable up to one hour. Catalog and voice management requests use 60 seconds.
- The host's execution timeout is independent; configure it to accommodate long generation calls. A client timeout does not cancel provider work.
- `saveDir` must already exist; it defaults to the OS temp directory. Files use exclusive creation and mode `0600`.
- Authentication uses Runline's redirect-refusing `authedFetch` against the fixed ElevenLabs API origin.

## References

The [official ElevenLabs n8n node](https://github.com/elevenlabs/elevenlabs-n8n) provides the speech/voice operation baseline. Request fields are checked against the [official OpenAPI schema](https://api.elevenlabs.io/openapi.json) and [music API](https://elevenlabs.io/docs/api-reference/music/compose). Implementation uses Runline's TypeBox schemas, shared bounded readers, path-segment validation, and media-file writer; it does not depend on n8n.
