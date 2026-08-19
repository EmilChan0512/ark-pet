# Perception and Agency Architecture

## MVP data flow

```text
native foreground observer (permission gated)
  -> built-in PerceptionModuleRegistry
  -> short-lived raw observation
  -> deterministic local interpreter
  -> CharacterMind
  -> initiative threshold + cooldown
  -> ContextEventBus
  -> ReactionEngine + character persona
  -> existing behavior / speech boundaries
```

`PerceptionModuleRegistry` is a static composition point, not a public plugin
loader. It keeps the MVP easy to extend in source while avoiding package trust,
versioning, permission delegation, and third-party execution concerns before
the product needs them.

## Ownership

- Native desktop awareness owns OS sampling and permission-dependent title
  collection.
- `DesktopTitlePerceptionModule` converts permitted samples into ephemeral
  observations.
- `PerceptionAgency` owns debounce, local interpretation, `CharacterMind`, and
  initiative policy.
- `ContextEventBus` carries only minimized semantic scenes.
- The persona owns character-specific expression. It never receives raw title
  text.
- The independent debug window receives a redacted `DebugSnapshot` over Tauri
  events and sends typed development commands back to the main window.

## CharacterMind contract

The debug-safe mind snapshot contains status, mood, semantic scene, attention,
a generic observation label, thought, intent, action, block reason, and
generation. It deliberately has no raw-content or arbitrary metadata field.

Permission or lifecycle changes increment the generation and invalidate any
pending title debounce. Destroy unsubscribes the module registry before the
native desktop observer is destroyed.

## Future richer interpretation

A later provider may use the OpenAI Responses API for image understanding while
keeping the API key in the native process. Screen images can be supplied as
Base64 image input and results constrained by Structured Outputs. The schema
must use an object root, require every field, and set
`additionalProperties: false`. Local deterministic interpretation remains the
offline/error fallback.

References:

- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

That provider and its screen-capture permission are backlog items, not Phase 11
runtime dependencies.
