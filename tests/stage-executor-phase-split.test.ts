import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/skill-loader', () => ({
  SkillLoader: { getSkillPromptAsync: async () => 'SYSTEM PROMPT' },
}))
vi.mock('@/src/lib/anthropic', () => ({
  handleAnthropicCreditError: async () => null,
}))

import { StageExecutor } from '@/src/services/stage-executor'

interface FakeCall {
  text: string
  stopReason?: string
  inputTokens?: number
  outputTokens?: number
}

/**
 * Fake Anthropic client. The reply depends on the last user message:
 * an outline request gets the outline, a per-phase request gets that phase's section.
 */
function fakeClient(answer: (prompt: string) => FakeCall) {
  const calls: string[] = []
  const client = {
    messages: {
      stream: (params: { messages: Array<{ role: string; content: string }> }) => {
        const prompt = params.messages[params.messages.length - 1].content
        calls.push(prompt)
        const reply = answer(prompt)
        const events = [
          { type: 'message_start', message: { usage: { input_tokens: reply.inputTokens ?? 100 } } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: reply.text } },
          {
            type: 'message_delta',
            delta: { stop_reason: reply.stopReason ?? 'end_turn' },
            usage: { output_tokens: reply.outputTokens ?? 50 },
          },
        ]
        return {
          abort: () => {},
          [Symbol.asyncIterator]: async function* () {
            yield* events
          },
        }
      },
    },
  }
  return { client, calls }
}

async function drain(gen: AsyncGenerator<string, string, undefined>) {
  const chunks: string[] = []
  for (;;) {
    const r = await gen.next()
    if (r.done) return { yielded: chunks.join(''), returned: r.value }
    chunks.push(r.value)
  }
}

const OUTLINE = [
  '## Phase 0: Scaffold',
  'Sets up the project.',
  '## Phase 1: Engine',
  'Core logic.',
  '## Phase 2: Interface',
  'Screens.',
].join('\n')

function answerFor(prompt: string): FakeCall {
  if (prompt.includes('PHASE OUTLINE ONLY')) {
    return { text: OUTLINE, inputTokens: 200, outputTokens: 40 }
  }
  const m = prompt.match(/Write ONLY the complete section for Phase (\d+): ([^,\n]+)/)
  if (!m) throw new Error('unexpected prompt: ' + prompt.slice(-200))
  return {
    text: `Full body for ${m[2].trim()}.`,
    inputTokens: 300,
    outputTokens: 1000,
  }
}

describe('StageExecutor phase-builder split', () => {
  it('makes one outline call and one call per phase, and returns the phases in order', async () => {
    const { client, calls } = fakeClient(answerFor)
    const executor = new StageExecutor(client as never)
    const { yielded, returned } = await drain(executor.executeStage('phase-builder', 'PRD TEXT', []))

    expect(calls).toHaveLength(4) // outline + 3 phases
    expect(yielded).toBe(returned)
    expect(yielded).not.toContain('Sets up the project.') // outline text is not in the artifact
    const i0 = yielded.indexOf('## Phase 0: Scaffold')
    const i1 = yielded.indexOf('## Phase 1: Engine')
    const i2 = yielded.indexOf('## Phase 2: Interface')
    expect(i0).toBeGreaterThanOrEqual(0)
    expect(i1).toBeGreaterThan(i0)
    expect(i2).toBeGreaterThan(i1)
    expect(yielded).toContain('Full body for Engine.')
  })

  it('adds up token usage across all calls', async () => {
    const { client } = fakeClient(answerFor)
    const executor = new StageExecutor(client as never)
    await drain(executor.executeStage('phase-builder', 'PRD TEXT', []))
    expect(executor.lastUsage).not.toBeNull()
    expect(executor.lastUsage!.inputTokens).toBe(200 + 3 * 300)
    expect(executor.lastUsage!.outputTokens).toBe(40 + 3 * 1000)
  })

  it('fails the stage if one phase is cut off at the token limit', async () => {
    const { client } = fakeClient((prompt) => {
      if (prompt.includes('Phase 1: Engine')) {
        return { text: 'partial', stopReason: 'max_tokens' }
      }
      return answerFor(prompt)
    })
    const executor = new StageExecutor(client as never)
    await expect(drain(executor.executeStage('phase-builder', 'PRD TEXT', []))).rejects.toThrow()
  })

  it('leaves other skills as a single call', async () => {
    const { client, calls } = fakeClient(() => ({ text: 'PRD body' }))
    const executor = new StageExecutor(client as never)
    const { yielded } = await drain(executor.executeStage('prd-architect', 'INPUT', []))
    expect(calls).toHaveLength(1)
    expect(yielded).toBe('PRD body')
  })

  it('falls back to a single call when the outline has no phase headings', async () => {
    const { client, calls } = fakeClient((prompt) =>
      prompt.includes('PHASE OUTLINE ONLY') ? { text: 'no headings here' } : { text: 'whole doc' },
    )
    const executor = new StageExecutor(client as never)
    const { yielded } = await drain(executor.executeStage('phase-builder', 'PRD TEXT', []))
    expect(calls).toHaveLength(2) // outline + the original single call
    expect(yielded).toBe('whole doc')
  })
})
