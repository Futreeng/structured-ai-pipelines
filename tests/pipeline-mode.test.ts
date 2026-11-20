import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/prisma', () => import('./__mocks__/prisma'))
vi.mock('@/src/services/skill-loader', () => ({
  SkillLoader: { getSkillPromptAsync: vi.fn().mockResolvedValue('SKILL: never write code without user confirmation.') },
}))
vi.mock('@/src/lib/anthropic', () => ({ handleAnthropicCreditError: vi.fn() }))

import type Anthropic from '@anthropic-ai/sdk'
import { StageExecutor } from '../src/services/stage-executor'
import { isCodeBuildSkill, pipelineModeOverride } from '../src/services/pipeline-mode'

function fakeClient(captured: { params?: Record<string, unknown> }) {
  return {
    messages: {
      stream: (params: Record<string, unknown>) => {
        captured.params = params
        const events = [
          { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
        ]
        return { abort: () => {}, async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
      },
    },
  } as unknown as Anthropic
}

async function drain(gen: AsyncGenerator<string, string, undefined>) {
  for (;;) if ((await gen.next()).done) return
}

describe('pipeline mode for code-building stages', () => {
  it('knows which skills build code', () => {
    expect(isCodeBuildSkill('phase-executor')).toBe(true)
    expect(isCodeBuildSkill('fix-executor')).toBe(true)
    expect(isCodeBuildSkill('prd-architect')).toBe(false)
    expect(pipelineModeOverride('phase-executor')).toContain('PIPELINE MODE')
    expect(pipelineModeOverride('prompt-builder')).toBe('')
  })

  it('appends the no-questions override to the system prompt and uses medium effort for builds', async () => {
    const captured: { params?: Record<string, unknown> } = {}
    await drain(new StageExecutor(fakeClient(captured)).executeStage('phase-executor', 'Build phase 2', []))

    const system = String(captured.params?.system)
    expect(system).toContain('never write code without user confirmation') // the skill is still there
    expect(system).toContain('THIS OVERRIDES ANY INSTRUCTION ABOVE TO ASK, CONFIRM OR WAIT')
    expect(system).toContain('A response that contains no code files is a failed build')
    expect(captured.params?.output_config).toEqual({ effort: 'medium' })
  })

  it('leaves other stages untouched: no override, low effort', async () => {
    const captured: { params?: Record<string, unknown> } = {}
    await drain(new StageExecutor(fakeClient(captured)).executeStage('prompt-builder', 'Write prompts', []))

    expect(String(captured.params?.system)).not.toContain('PIPELINE MODE')
    expect(captured.params?.output_config).toEqual({ effort: 'low' })
  })
})
