# Phase 3 Requirements: Directional Motion

## Goal

Make existing pet interactions visually match the user's movement. Phase 3
focuses on direction-aware animation orchestration for the current single
character. It does not add autonomous walking, path finding, AI behavior,
additional characters, or new animation assets.

## Functional scope

- Declare the character artwork's native facing direction in its manifest.
- Play the configured `drag` animation once when dragging starts and keep it
  looping for the drag session.
- Face left while the pointer is moving left and face right while it is moving
  right.
- Preserve the last facing direction during primarily vertical movement.
- Return to the configured idle animation when dragging ends or is cancelled.
- Preserve the current facing direction after the drag ends.
- Keep click interaction behavior unchanged.

## Direction rules

- Direction is calculated from the system cursor's physical screen position,
  using the same coordinate space as the native window.
- Horizontal movement must exceed a small dead zone before changing facing.
- A direction change flips the existing Spine instance; it must not reload the
  character or restart the current animation.
- Character scale remains the product of manifest scale and user scale. Facing
  only changes the sign of the horizontal scale.

## Manifest contract

Character manifests may define:

```json
{
  "nativeFacing": "right"
}
```

`nativeFacing` is either `left` or `right` and defaults to `right` for backward
compatibility.

## Acceptance criteria

1. Starting a drag transitions from idle to the configured `Move` animation.
2. Dragging left visibly faces the character left.
3. Dragging right visibly faces the character right.
4. Vertical movement does not rapidly alternate facing.
5. Small horizontal cursor jitter does not change facing.
6. Reversing direction flips the current Spine instance without restarting
   `Move`.
7. Pointer release and pointer cancellation return the pet to idle.
8. Facing changes do not move the character's visual foot anchor.
9. Character scale settings continue to apply in both directions.
10. Phase 1 and Phase 2 interaction, persistence, tray, and passthrough
    behavior remains intact.
11. TypeScript build, lint, native Tauri build, and a clean runtime launch pass.
