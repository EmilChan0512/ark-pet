# Phase 7 Requirements: Character Speech

## Goal

Add readable text presentation and optional offline character speech without
coupling behavior selection to a concrete voice engine. Voice identity is a
safety invariant: an unavailable or untrusted voice must degrade to text, never
to a system voice, generic voice, approximate voice, or another character.

Phase 7 keeps Tauri 2, React/TypeScript/Vite, PixiJS 7.4.3, and
`@pixi-spine/all-3.8` 4.0.6. It adds no network, Wiki API, cloud AI, telemetry,
or public model-import surface.

## Product rules

- Dynamic text may use only the pinned Pepe AI identity
  `pepe.zh-CN.cn_012` for character `char_4058_pepe`.
- A fixed cue prefers a user-verified Pepe game clip.
- A verified original clip may replace the visible text only atomically with
  its canonical transcript.
- Under `exact-clip-only`, a clip is usable only when punctuation-insensitive
  normalized text matches the requested text.
- Under `cue-and-text-replacement`, a verified cue may replace both audio and
  visible text with its canonical transcript.
- Missing configuration, unsupported platform, timeout, cancellation, corrupt
  audio, identity mismatch, playback rejection, and engine failure all remain
  text-only.
- System TTS and non-Pepe voices are prohibited fallbacks.

## Text presentation

The DOM adapter, not Pixi or Spine, owns the speech bubble. The coordinator
provides a presentation record; the adapter computes a viewport-safe placement
from the current character bounds. It prefers a bubble above the character,
then below, and finally a bottom subtitle when neither fits. It clamps to a
12-pixel safe inset and limits width to the smaller of 320 pixels or the
available viewport width.

Only one utterance is visible. The coordinator owns a queue of at most six
pending requests. Default priorities are system 300, interaction 200, local
integration 150, and ambient 50. Higher priority interrupts lower priority.
Equal-priority items remain FIFO. A repeated `dedupeKey` is latest-wins.
Expired items never display.

Text appears immediately. Its duration is `2200 ms + 90 ms` per Unicode code
point, clamped to 2500–9000 ms. When voice is enabled, the bubble is retained
for at least the 12000 ms synthesis budget plus 500 ms. The hard session limit
is 25000 ms, and completed audio leaves a 350 ms visual tail. The longer local
budget is deliberate: text is already readable while the Windows/CUDA engine
finishes inference and transfers the WAV through IPC.

## Voice boundaries

Three layers remain separate:

1. A `SpeakRequest` identifies text source, cue, priority, expiry, and dedupe
   semantics. Producers do not select an engine.
2. `CharacterVoiceResolverPort` chooses only an identity-safe original clip or
   pinned AI artifact. Tauri owns package validation, local process execution,
   and platform capability checks.
3. `AudioPlaybackPort` owns browser audio objects and stops them on replacement,
   pause, reload, disable, hide, or destruction.

`BehaviorEngine` may produce an interaction that ultimately creates a speech
request, but it does not import speech or TTS types. `PetRuntime` is the
composition root. External integrations dispatch `speak` and `cancel-speech`
through `RuntimeCommandCoordinator`; enqueueing does not block the runtime
command queue for the duration of playback.

Development voice controls may explicitly dispatch `prepare-character-voice`
before `speak` so a cold model load cannot consume the utterance synthesis
budget. Preparation is idempotent and is separate from playback ownership.

## Synchronization, cancellation, and cleanup

Each active session owns one `AbortController` and one monotonically increasing
generation. An adapter receives the signal for cooperative cancellation; the
generation is the final guard against late, non-cooperative results. Audio may
start only after character ID, character generation, and voice identity all
match the active context.

Original audio and canonical text are committed in the same presentation
update. AI audio retains the requested text. A newer interaction cannot be
overwritten by an older synthesis result.

Hide, reload, settings interaction, voice disable, and destroy cancel active
and queued sessions, stop playback, and prevent late playback. Destroy awaits
voice resolver shutdown before the runtime disappears. The current development
worker cannot preempt a GPU inference already inside GPT-SoVITS; cancellation
immediately invalidates the session and discards its result, while the worker
may finish that inference before accepting another request or exiting.

## Settings and migration

Settings use `ark-pet.settings.v3`:

- `speechMode`: `off`, `text`, or `character-voice`; default `text`.
- `characterVoiceVolume`: 0–1; default `0.8`.
- `characterVoiceFallback`: `exact-clip-only` or
  `cue-and-text-replacement`; default `cue-and-text-replacement`.

The pure parser migrates v2 by preserving all previous values and adding the
three speech defaults. It also migrates v1 by adding the Phase 5 autonomous
behavior default first. Invalid or unknown data falls back safely instead of
being partially applied.

## Platform capability boundary

The Tauri service reports configuration, original-clip, and AI capabilities
separately. Windows may expose local AI only when the pinned package, Python
runtime, GPT-SoVITS engine, and CUDA development environment are present.
macOS reports AI unavailable in Phase 7. Verified original clips remain a
platform-neutral file/ZIP path when the external package is configured;
otherwise both platforms show text.

Frontend callers cannot provide arbitrary filesystem paths. Development paths
come from ignored `src-tauri/voice-package.local.json` or the documented
`ARK_PET_*` environment variables.

## Security, privacy, and performance

- The native boundary pins character and voice identifiers and validates the
  profile, cue registry, locale, verification status, filename, size, and
  SHA-256 before returning audio.
- The worker receives only local text over JSON Lines. No request text is
  persisted or intentionally logged; GPT-SoVITS stdout is suppressed during
  inference.
- One persistent worker avoids loading model weights per utterance. A native
  mutex permits one inference at a time and the frontend queue is bounded.
- Synthesized and original audio are returned as opaque data URIs; the frontend
  never learns package paths.
- Requested text is limited to 1–256 characters. Original clips are capped at
  8 MiB and worker output base64 is bounded.

## Included in Phase 7

- DOM bubble/subtitle placement and safe clamping;
- deterministic queue, priority, expiry, timeout, interruption, and cleanup;
- v3 settings and v1/v2 migration;
- typed runtime commands for speech;
- verified Pepe original-cue playback;
- Windows/CUDA development integration with the pinned GPT-SoVITS v2ProPlus
  zero-shot model delivered outside Git;
- text-only safety degradation and development diagnostics;
- unit, build, lint, Rust compile, and local smoke verification.

## Deferred

- release packaging of Python, CUDA libraries, GPT-SoVITS, and model weights;
- model download, installation, upgrade, repair, or custom model import UI;
- macOS AI synthesis and CPU/Metal performance acceptance;
- streaming/fragment playback, phoneme timing, lip sync, audio ducking, and
  multi-character mixing;
- cloud synthesis, system TTS, generic voices, voice cloning workflow, and
  network text generation;
- authoring more cue mappings beyond user-verified source material.

## Acceptance criteria

1. Text appears immediately and remains within the viewport or subtitle safe
   area for representative character bounds and narrow windows.
2. Tests prove priority preemption, FIFO order, dedupe, expiry, timeout,
   canonical transcript replacement, identity rejection, and cleanup.
3. Behavior modules do not import a TTS engine or audio API.
4. Runtime speech commands do not hold the command queue for playback.
5. Dynamic AI playback uses only the pinned Pepe identity; every unavailable,
   mismatched, cancelled, or failed path stays text-only.
6. A verified cue returns only after registry, identity, locale, filename,
   size, and checksum validation.
7. Hide, reload, settings UI, disable, rapid replacement, and destroy cannot
   cause stale audio or stale text to reappear.
8. v1 and v2 settings migrate deterministically to v3.
9. The repository contains no voice weights, source archive, reference audio,
   generated WAV, or machine-local configuration.
10. Tests, production build, lint, `cargo check`, and Windows development smoke
    verification pass.
