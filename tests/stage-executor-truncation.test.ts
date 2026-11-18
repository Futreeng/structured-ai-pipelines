import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/prisma', () => import('./__mocks__/prisma'))
vi.mock('@/src/services/skill-loader', () => ({
  SkillLoader: { getSkillPromptAsync: vi.fn().mockResolvedValue('You write PRDs.') },
}))
vi.mock('@/src/lib/anthropic', () => ({ handleAnthropicCreditError: vi.fn() }))

import type Anthropic from '@anthropic-ai/sdk'
import { DOCUMENT_MAX_TOKENS, OutputTruncatedError } from '../src/lib/models'
import { StageExecutor } from '../src/services/stage-executor'

/** A fake Anthropic client whose stream emits some text, then ends with the given stop_reason. */
function fakeClient(stopReason: string, captured: { params?: Record<string, unknown> }) {
  return {
    messages: {
      stream: (params: Record<string, unknown>) => {
        captured.params = params
        const events = [
          { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '# PRD\n\n## Phase 1' } },
          { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 30000 } },
        ]
        return {
          abort: () => {},
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event
          },
        }
      },
    },
  } as unknown as Anthropic
}

async function run(executor: StageExecutor) {
  const generator = executor.executeStage('prd-architect', 'Build a todo app', [])
  let text = ''
  for (;;) {
    const step = await generator.next()
    if (step.done) return { text, returned: step.value }
    text += step.value
  }
}

describe('StageExecutor output limits', () => {
  it('fails the stage when the model stops at max_tokens instead of returning a cut-off document', async () => {
    const captured: { params?: Record<string, unknown> } = {}
    const executor = new StageExecutor(fakeClient('max_tokens', captured))

    await expect(run(executor)).rejects.toBeInstanceOf(OutputTruncatedError)
    await expect(run(new StageExecutor(fakeClient('max_tokens', {})))).rejects.toThrow(/cut off at the 30,000-token limit/)

    // Cost is still recorded for the tokens that were spent
    expect(executor.lastUsage?.outputTokens).toBe(30000)
  })

  it('returns the document when the model finishes normally', async () => {
    const executor = new StageExecutor(fakeClient('end_turn', {}))
    const { text, returned } = await run(executor)

    expect(text).toBe('# PRD\n\n## Phase 1')
    expect(returned).toBe('# PRD\n\n## Phase 1')
  })

  it('uses the document token budget and low effort so thinking does not eat the output', async () => {
    const captured: { params?: Record<string, unknown> } = {}
    await run(new StageExecutor(fakeClient('end_turn', captured)))

    expect(captured.params?.max_tokens).toBe(DOCUMENT_MAX_TOKENS)
    expect(captured.params?.output_config).toEqual({ effort: 'low' })
  })
})
