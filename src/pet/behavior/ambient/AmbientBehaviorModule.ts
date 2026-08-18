import type { FacingDirection } from '../../../types/character'
import type { BehaviorDefinition, RandomPort } from '../types'

export const AMBIENT_BEHAVIOR_IDS = {
  walk: 'ambient.walk',
  sit: 'ambient.sit',
  sleep: 'ambient.sleep',
} as const

export type AmbientAnimationKind = 'walk' | 'sit' | 'sleep'

export interface AmbientAnimationPort {
  has(kind: AmbientAnimationKind): boolean
  enter(kind: AmbientAnimationKind): void
  setFacing(direction: FacingDirection): void
}

export interface PhysicalWindowGeometry {
  position: { x: number; y: number }
  size: { width: number; height: number }
  workArea: {
    position: { x: number; y: number }
    size: { width: number; height: number }
  }
}

export interface WindowMotionPort {
  getGeometry(): Promise<PhysicalWindowGeometry | null>
  requestPosition(x: number, y: number): void
  cancel(): Promise<void>
}

export interface AmbientBehaviorContext {
  ambientAnimation: AmbientAnimationPort
  windowMotion: WindowMotionPort
  random: RandomPort
}

const WALK_DISTANCE_MIN = 120
const WALK_DISTANCE_MAX = 320
const WALK_SPEED_MIN = 60
const WALK_SPEED_MAX = 90
const SIT_DURATION_MIN_MS = 8_000
const SIT_DURATION_MAX_MS = 20_000
const MAX_FRAME_STEP_MS = 50

function randomBetween(random: RandomPort, min: number, max: number) {
  const normalized = Math.min(Math.max(random.next(), 0), 0.999_999)
  return min + (max - min) * normalized
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Creates ambient definitions against a structural context. New modules can be
 * registered beside these without changing BehaviorEngine.
 */
export function createAmbientBehaviorDefinitions<Context extends AmbientBehaviorContext>():
  readonly BehaviorDefinition<Context>[] {
  return [
    {
      id: AMBIENT_BEHAVIOR_IDS.walk,
      priority: 20,
      tags: ['ambient'],
      isEligible: (context) => context.ambientAnimation.has('walk'),
      create: (context) => {
        let currentX = 0
        let currentY = 0
        let targetX = 0
        let targetY = 0
        let speed = 0
        let lastUpdateAt: number | null = null
        let completed = false

        return {
          async enter(signal) {
            const geometry = await context.windowMotion.getGeometry()
            if (signal.aborted || !geometry) {
              completed = true
              return
            }

            const direction = context.random.next() < 0.5 ? -1 : 1
            const distance = randomBetween(
              context.random,
              WALK_DISTANCE_MIN,
              WALK_DISTANCE_MAX,
            )
            speed = randomBetween(context.random, WALK_SPEED_MIN, WALK_SPEED_MAX)
            currentX = geometry.position.x
            currentY = geometry.position.y

            const workAreaMinX = geometry.workArea.position.x
            const workAreaMaxX =
              geometry.workArea.position.x +
              Math.max(geometry.workArea.size.width - geometry.size.width, 0)
            targetX = clamp(currentX + direction * distance, workAreaMinX, workAreaMaxX)
            const workAreaMinY = geometry.workArea.position.y
            const workAreaMaxY =
              geometry.workArea.position.y +
              Math.max(geometry.workArea.size.height - geometry.size.height, 0)
            targetY = clamp(currentY, workAreaMinY, workAreaMaxY)

            if (Math.hypot(targetX - currentX, targetY - currentY) < 1) {
              completed = true
              return
            }

            context.ambientAnimation.setFacing(targetX < currentX ? 'left' : 'right')
            context.ambientAnimation.enter('walk')
          },
          update(now) {
            if (completed) return 'completed'
            if (lastUpdateAt === null) {
              lastUpdateAt = now
              return 'continue'
            }

            // Clamp elapsed time so suspend/resume never teleports the native surface.
            const elapsed = clamp(now - lastUpdateAt, 0, MAX_FRAME_STEP_MS)
            lastUpdateAt = now
            const remainingX = targetX - currentX
            const remainingY = targetY - currentY
            const remainingDistance = Math.hypot(remainingX, remainingY)
            const step = Math.min(remainingDistance, speed * elapsed / 1000)
            const ratio = remainingDistance === 0 ? 1 : step / remainingDistance
            currentX += remainingX * ratio
            currentY += remainingY * ratio
            context.windowMotion.requestPosition(currentX, currentY)

            if (Math.hypot(targetX - currentX, targetY - currentY) < 0.5) {
              return 'completed'
            }
            return 'continue'
          },
          exit() {
            return context.windowMotion.cancel()
          },
        }
      },
    },
    {
      id: AMBIENT_BEHAVIOR_IDS.sit,
      priority: 10,
      tags: ['ambient'],
      isEligible: (context) => context.ambientAnimation.has('sit'),
      create: (context) => {
        const duration = randomBetween(
          context.random,
          SIT_DURATION_MIN_MS,
          SIT_DURATION_MAX_MS,
        )
        let startedAt: number | null = null
        return {
          enter: () => context.ambientAnimation.enter('sit'),
          update(now) {
            startedAt ??= now
            return now - startedAt >= duration ? 'completed' : 'continue'
          },
        }
      },
    },
    {
      id: AMBIENT_BEHAVIOR_IDS.sleep,
      priority: 30,
      tags: ['ambient', 'blocking'],
      isEligible: (context) => context.ambientAnimation.has('sleep'),
      create: (context) => ({
        enter: () => context.ambientAnimation.enter('sleep'),
      }),
    },
  ]
}
