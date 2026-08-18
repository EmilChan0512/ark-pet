# Speech System Architecture

## Ownership map

```text
Behavior / local integration / UI
              |
              v
        SpeakRequest
              |
 RuntimeCommandCoordinator (external ordering only)
              |
              v
          PetRuntime (composition root)
              |
              v
   SpeechSessionCoordinator
        |              |
        v              v
 TextPresentationPort  CharacterVoiceResolverPort
 (DOM bubble/subtitle)       |
                            v
                CharacterVoiceService (Tauri IPC)
                    |                   |
                    v                   v
          verified original ZIP   pinned local worker
                            |
                            v
                    AudioPlaybackPort
```

`SpeechSessionCoordinator` is the sole owner of the active utterance and
pending queue. `PetRuntime` owns when speech is permitted relative to hidden,
reload, UI-interaction, settings, and destroyed states. React renders settings
and diagnostics but does not own a speech session.

## Adding a producer

Create a `SpeakRequest` with a stable unique ID, truthful source, visible text,
optional verified cue, optional dedupe key, and a short expiry. External
producers dispatch `speak`; code already inside `PetRuntime` may enqueue at the
composition boundary. Do not call Tauri synthesis, create `Audio`, or choose a
voice from a behavior module.

Development controls that require a guaranteed warm model dispatch
`prepare-character-voice` before `speak`. The preparation command may hold the
runtime command queue during cold model loading, but the following `speak`
still settles after enqueueing and never waits for playback.

Use `system` only for application-critical text, `interaction` for direct user
actions, `local-integration` for trusted local features, and `ambient` for
optional chatter. A custom numeric priority should be exceptional and
documented at its producer.

## Identity invariant

An audio artifact is not trusted merely because it came from Tauri. Before
playback, the coordinator compares its `characterId`, `characterGeneration`,
and `voiceIdentity` with the context captured when the session started. Reload
increments character generation, so an old response cannot play for a newly
loaded character even when both manifests share an ID.

The native adapter independently pins Pepe identifiers and validates package
metadata and hashes. These checks are intentionally duplicated across the
trust boundary.

## Queue and time ownership

The coordinator uses the existing Pixi runtime ticker time supplied by
`PetRuntime.update`; it creates no display timers. This makes text deadlines
deterministic in tests and naturally pauses with runtime lifecycle policy.
Synthesis and playback remain promises because they are external resources.
Neither promise owns the visible session.

When a request replaces the active session, the coordinator first aborts and
invalidates the old generation, stops audio, hides old text, and settles its
promise. Only then can a new request become active. Pending queue capacity is
six; overflow evicts the oldest item among the lowest priority.

## Original cue and AI policy

With a cue, the Tauri resolver asks only for a registered, user-verified Pepe
original clip. Under the permissive fallback setting, its canonical transcript
atomically replaces the requested text. Under strict mode, normalized texts
must match.

Without a cue, the resolver requests synthesis from the pinned local Pepe
worker. No alternate voice resolver is chained after it. Failure therefore
returns to the already-visible text rather than searching for a different
voice.

## Cancellation and late results

The active `AbortSignal` is cooperative. Tauri records cancelled request IDs,
the player pauses its current element, and the presentation is hidden. The
session generation is authoritative: even if an engine ignores cancellation,
its late artifact cannot mutate the current session.

The native development worker serializes inference behind one mutex. A cancel
request can mark an ID while inference is running, but GPT-SoVITS itself does
not expose safe mid-call interruption here. The completed WAV is discarded.
Do not weaken the frontend generation check when adding process termination or
streaming later.

## Resource cleanup

- Presentation adapter removes its DOM node on destroy.
- Playback adapter pauses and detaches the current audio element listeners via
  the session abort path.
- Resolver forwards cancellation and shuts down the native worker.
- Tauri kills and waits for the child at shutdown and clears cancellation IDs.
- `PetRuntime.destroy` awaits speech destruction before destroying rendering.

Any future adapter that creates Blob URLs, temporary files, streams, or audio
contexts must document which layer owns revocation/close and must clean them on
normal end, replacement, failure, and destroy.

## Development voice configuration

The 1.93 GB development delivery remains outside the repository. Configure it
with ignored `src-tauri/voice-package.local.json` or these environment variables:

- `ARK_PET_PEPE_VOICE_PACKAGE_DIR`
- `ARK_PET_PYTHON_EXECUTABLE`
- `ARK_PET_GPT_SOVITS_ENGINE_DIR`

The pinned development identity uses character `char_4058_pepe`, locale
`zh-CN`, reference `cn_012`, 32 kHz 16-bit mono WAV output, and GPT-SoVITS
`20250606v2pro`. These values are compatibility facts, not a public model
selection API.

## Test strategy

Keep coordinator tests pure with injected presentation, resolver, player, and
ticker values. Test layout as a pure function. Test resolver policies with a
fake `CharacterVoiceService`. Native smoke tests must verify capability output,
original clip hash validation, worker identity handshake, one dynamic output,
cancellation/late-result rejection, and shutdown with no child left running.
