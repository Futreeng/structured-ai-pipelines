import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/prisma', () => import('./__mocks__/prisma'))
vi.mock('@/src/services/skill-loader', () => ({
  SkillLoader: { getSkillPromptAsync: vi.fn().mockResolvedValue('SKILL PROMPT') },
}))
vi.mock('@/src/lib/anthropic', () => ({ handleAnthropicCreditError: vi.fn() }))

import Anthropic from '@anthropic-ai/sdk'
import { StageExecutor } from '../src/services/stage-executor'
import { assertStageApprovable, BUDGET_EXCEEDED_MARKER } from '../src/services/stage-approval'

type Captured = { params?: { messages: Array<{ role: string; content: unknown }> } & Record<string, unknown> }

/** A stand-in with the real Anthropic prototype, so the executor treats it as the real client. */
function fakeAnthropic(captured: Captured, usage: Record<string, number> = { input_tokens: 100 }) {
  const client = Object.create(Anthropic.prototype) as Anthropic
  ;(client as unknown as { messages: unknown }).messages = {
    stream: (params: Captured['params']) => {
      captured.params = params
      const events = [
        { type: 'message_start', message: { usage: { output_tokens: 0, ...usage } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
      ]
      return { abort: () => {}, async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
    },
  }
  return client
}

async function runSingle(
  executor: StageExecutor,
  context: string,
  previous: string[],
  sharedPrefix?: string,
) {
  const run = (executor as unknown as {
    executeSingle: (s: string, c: string, p: string[], sig?: AbortSignal, u?: unknown, prefix?: string) => AsyncGenerator<string, string>
  }).executeSingle.bind(executor)
  const gen = run('phase-builder', context, previous, undefined, undefined, sharedPrefix)
  for (;;) if ((await gen.next()).done) return
}

const PRD = 'PRD line about the product.\n'.repeat(500) // well over the cache minimum

describe('duplicate input', () => {
  it('does not send an earlier artifact as its own message when the context already contains it', async () => {
    const captured: Captured = {}
    const context = `## Generate PRD (dependency)\n\n${PRD}\n\nSplit it.`
    await runSingle(new StageExecutor(fakeAnthropic(captured)), context, [PRD])

    expect(captured.params?.messages).toHaveLength(1)
    expect(captured.params?.messages[0]).toMatchObject({ role: 'user', content: context })
  })

  it('still sends an earlier artifact that is NOT inside the context', async () => {
    const captured: Captured = {}
    await runSingle(new StageExecutor(fakeAnthropic(captured)), 'Do the next thing.', ['An earlier result'])

    expect(captured.params?.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'user'])
  })
})

describe('prompt cache for the shared PRD', () => {
  const context = `${PRD}\n\nWrite ONLY Phase 3.`

  it('puts a cache breakpoint on the shared opening and leaves the rest uncached', async () => {
    const captured: Captured = {}
    await runSingle(new StageExecutor(fakeAnthropic(captured)), context, [], PRD)

    const content = captured.params?.messages[0].content as Array<{ text: string; cache_control?: unknown }>
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: PRD, cache_control: { type: 'ephemeral' } })
    expect(content[1].cache_control).toBeUndefined()
    expect(content[0].text + content[1].text).toBe(context) // nothing lost or reordered
  })

  it('sends a plain string when the shared opening is short, or does not match', async () => {
    const short: Captured = {}
    await runSingle(new StageExecutor(fakeAnthropic(short)), 'short context plus more', [], 'short context')
    expect(typeof short.params?.messages[0].content).toBe('string')

    const mismatch: Captured = {}
    await runSingle(new StageExecutor(fakeAnthropic(mismatch)), context, [], `${PRD} different`)
    expect(typeof mismatch.params?.messages[0].content).toBe('string')
  })

  it('never sends content blocks to a non-Anthropic client (Groq/Ollama expect strings)', async () => {
    const captured: Captured = {}
    const notAnthropic = { messages: { stream: fakeAnthropic(captured).messages.stream } } as unknown as Anthropic
    await runSingle(new StageExecutor(notAnthropic), context, [], PRD)

    expect(typeof captured.params?.messages[0].content).toBe('string')
  })
})

describe('cost of cached input', () => {
  it('counts cache writes at 1.25x and cache reads at 0.1x of normal input tokens', async () => {
    const executor = new StageExecutor(
      fakeAnthropic({}, { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000 }),
    )
    await runSingle(executor, 'ctx', [])

    // 100 + 1000 * 1.25 + 2000 * 0.1 = 1550
    expect(executor.lastUsage?.inputTokens).toBe(1550)
    expect(executor.lastUsage?.outputTokens).toBe(7)
  })

  it('is unchanged when no cache is involved', async () => {
    const executor = new StageExecutor(fakeAnthropic({}, { input_tokens: 4321 }))
    await runSingle(executor, 'ctx', [])
    expect(executor.lastUsage?.inputTokens).toBe(4321)
  })
})

describe('a stage the budget guard refused', () => {
  const refused = {
    displayName: 'Phase 0: Project Scaffolding — Build',
    status: 'awaiting_approval',
    artifactContent: `${BUDGET_EXCEEDED_MARKER}\n\nRun budget exceeded: current $3.93 ...`,
  }

  it('cannot be approved, so an empty build never passes as complete', () => {
    expect(() => assertStageApprovable(refused)).toThrow(/budget limit was reached/)
    expect(() => assertStageApprovable(refused)).toThrow(/FORGE_RUN_BUDGET_USD/)
  })

  it('still allows a stage with real output, and an explicit edit of the content', () => {
    expect(() => assertStageApprovable({ ...refused, artifactContent: '# real output' })).not.toThrow()
    expect(() => assertStageApprovable(refused, '# the user wrote this')).not.toThrow()
  })
})
