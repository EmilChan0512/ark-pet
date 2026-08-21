import { z } from 'zod'
import type { CharacterPersona } from './types'

const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click-count'), min: z.number().optional(), max: z.number().optional() }).strict(),
  z.object({ type: z.literal('idle-ms'), min: z.number().nonnegative() }).strict(),
  z.object({ type: z.literal('active-ms'), min: z.number().nonnegative() }).strict(),
  z.object({ type: z.literal('period'), value: z.enum(['morning', 'day', 'evening', 'late-night']) }).strict(),
  z.object({ type: z.literal('desktop-category'), value: z.enum([
    'development', 'browsing', 'communication', 'productivity', 'creative',
    'media', 'gaming', 'system', 'other', 'unknown',
  ]) }).strict(),
  z.object({ type: z.literal('idle-bucket'), value: z.enum(['short', 'medium', 'long']) }).strict(),
  z.object({ type: z.literal('perception-scene'), value: z.enum([
    'coding-problem', 'focused-reading', 'media', 'conversation', 'general',
  ]) }).strict(),
])

const planStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('behavior'), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('animation'), name: z.string().min(1) }).strict(),
  z.object({
    type: z.literal('speak'),
    text: z.string().min(1).max(256),
    source: z.enum(['interaction', 'ambient']),
    cue: z.string().min(1).optional(),
    dedupeKey: z.string().min(1).optional(),
  }).strict(),
  z.object({ type: z.literal('wait'), durationMs: z.number().min(0).max(30_000) }).strict(),
])

const personaSchema = z.object({
  version: z.literal(1),
  characterId: z.string().min(1),
  displayName: z.string().min(1),
  metadata: z.record(z.string(), z.string()).optional(),
  reactions: z.array(z.object({
    id: z.string().min(1),
    event: z.enum([
      'pet.clicked', 'pet.drag-started', 'pet.drag-ended', 'session.started',
      'session.first-meeting-today', 'session.user-returned', 'session.long-active',
      'time.period-entered',
      'desktop.activity-category-entered', 'desktop.system-idle-entered',
      'desktop.system-idle-returned', 'desktop.session-locked', 'desktop.session-unlocked',
      'perception.scene-noticed',
    ]),
    priority: z.number().finite(),
    weight: z.number().positive().optional(),
    cooldownMs: z.number().nonnegative().optional(),
    cooldownGroup: z.string().min(1).optional(),
    oncePerLocalDay: z.boolean().optional(),
    conditions: z.array(conditionSchema).optional(),
    plan: z.array(planStepSchema).min(1).max(8),
  }).strict()).min(1),
}).strict()

export function parseCharacterPersona(value: unknown): CharacterPersona {
  const result = personaSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`Character Persona Error: ${z.prettifyError(result.error)}`)
  }
  const ids = new Set<string>()
  for (const reaction of result.data.reactions) {
    if (ids.has(reaction.id)) throw new Error(`Character Persona Error: duplicate reaction id ${reaction.id}`)
    ids.add(reaction.id)
  }
  return result.data
}

export async function loadCharacterPersona(
  characterId: string,
  personaPath = `/characters/${encodeURIComponent(characterId)}/persona.json`,
): Promise<CharacterPersona> {
  const response = await fetch(personaPath)
  if (!response.ok) throw new Error(`Character Persona Error: ${response.status} ${response.statusText}`)
  return parseCharacterPersona(await response.json())
}
