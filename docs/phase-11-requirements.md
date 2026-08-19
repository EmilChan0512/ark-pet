# Phase 11 — Perception and Agency MVP

## Product premise

The pet is treated as a person who lives beside the user. She notices what is
happening, forms a private internal state, and decides for herself whether to
act or speak. The product must not turn an active thought or behavior into a
runtime approval prompt.

Users shape her through durable Settings boundaries:

- privacy permissions determine what she may perceive;
- personality style changes how readily she takes initiative;
- behavior and speech settings shape what she can express;
- disabling a permission immediately stops that observation path.

## MVP scope

Phase 11 ships one real vertical slice instead of a generalized plugin system:

1. An explicit content-perception disclosure permits foreground window-title
   observation on Windows.
2. A built-in perception module keeps raw titles in short-lived memory only.
3. A deterministic local interpreter produces a scene, mood, attention level,
   thought, and intent.
4. The character mind decides whether the scene crosses its personality
   threshold and initiative cooldown.
5. Eligible intent enters the existing typed reaction engine, where the
   character persona chooses the actual line or behavior.
6. A separate development window presents compact Senses, Mind, Voice,
   Runtime, and Logs views without resizing or moving the pet window.

The stable-title debounce is three seconds. Initiative styles are deliberately
conservative:

| Style | Minimum attention | Initiative cooldown |
| --- | ---: | ---: |
| Quiet | 0.80 | 60 minutes |
| Balanced | 0.45 | 20 minutes |
| Expressive | 0.20 | 8 minutes |

## Privacy acceptance

- Content perception is disabled by default and requires a versioned consent.
- The native observer receives `includeWindowTitle: false` without that
  consent.
- Raw titles are never persisted, uploaded, added to persona input, or exposed
  in the normal debug snapshot or decision log.
- Lock state and system windows suppress title observation.
- Disabling content perception invalidates pending observations and cancels
  output initiated by that path.

## Explicit exclusions

- No allow, ignore, snooze, or cancel-current-thought runtime UI.
- No dynamic third-party sensor/plugin loading.
- No microphone, voice reply, or extended voice interaction in this phase.
- No screen capture, browser URL, filename, typed input, clipboard, message, or
  notification observation yet.
- No network perception provider in the MVP.

## Acceptance checklist

- The main pet window stays at its normal geometry when debug is enabled.
- The debug window opens independently and restores after being closed/hidden.
- Foreground titles are not requested before explicit content consent.
- A stable error/failure title forms a concerned `coding-problem` mind state.
- Quiet/balanced/expressive styles apply different initiative thresholds and
  cooldowns without runtime approval controls.
- Voice synthesis status and progress logs are visible in the Voice tab.
- All frontend, Rust, build, lint, and privacy gates pass.

## Backlog

Add permission-scoped built-in sensors only when a product use case needs them:
screen pixels/vision, browser URL, active file/project, input context,
clipboard, messages, and notifications. A provider interface for richer cloud
interpretation can follow after the local product loop proves useful.
