import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/skill-loader', () => ({
  SkillLoader: { getSkillPromptAsync: async () => 'SYSTEM PROMPT' },
}))
vi.mock('@/src/lib/anthropic', () => ({
  handleAnthropicCreditError: async () => null,
}))

import { StageExecutor } from '@/src/services/stage-executor'
import {
  buildPrdHeadPrompt,
  buildPrdOutlineInstruction,
  buildPrdPhasePrompt,
  buildPrdTailPrompt,
  ensurePrdPhaseHeading,
  mergePrdParts,
} from '@/src/services/prd-split'
import { parseOutline } from '@/src/services/phase-split'
import { GraphExpander } from '@/src/services/graph-expander'

interface FakeReply {
  text: string
  stopReason?: string
  inputTokens?: number
  outputTokens?: number
}

function fakeClient(answer: (prompt: string) => FakeReply) {
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
  '### Phase 0: Scaffold',
  'Sets up the project.',
  '### Phase 1: Engine',
  'Core logic.',
  '### Phase 2: Interface',
  'Screens.',
].join('\n')

function answerFor(prompt: string): FakeReply {
  if (prompt.includes('PRD OUTLINE ONLY')) {
    return { text: OUTLINE, inputTokens: 200, outputTokens: 40 }
  }
  if (prompt.includes('Write ONLY the document from the title through section 5')) {
    return { text: '# Poker — PRD\n\n## 1. Executive Summary\nText\n\n## 5. Coding Standards (Project-Specific)\nRules', inputTokens: 300, outputTokens: 1000 }
  }
  if (prompt.includes('Write ONLY sections 7 through 9')) {
    return { text: '## 7. Risk Register\nRisks\n\n## 9. Project Logging\nLogs', inputTokens: 300, outputTokens: 1000 }
  }
  const m = prompt.match(/Write ONLY the section for Phase (\d+): ([^,\n]+)/)
  if (!m) throw new Error('unexpected prompt: ' + prompt.slice(-200))
  return { text: `Body for ${m[2].trim()}.`, inputTokens: 300, outputTokens: 1000 }
}

describe('prd-split helpers', () => {
  it('outline instruction asks for ### Phase headings and caps the count', () => {
    const text = buildPrdOutlineInstruction(10)
    expect(text).toContain('### Phase <number>: <short name>')
    expect(text).toContain('between 2 and 10 phases')
  })

  it('outline is read by the same parser as the phase list', () => {
    expect(parseOutline(OUTLINE)).toEqual([
      { index: 0, name: 'Scaffold' },
      { index: 1, name: 'Engine' },
      { index: 2, name: 'Interface' },
    ])
  })

  it('head, phase and tail prompts each ask for only their own part', () => {
    const phase = { index: 1, name: 'Engine' }
    expect(buildPrdHeadPrompt('CTX', OUTLINE)).toContain('Do not write section 6')
    expect(buildPrdPhasePrompt('CTX', OUTLINE, phase)).toContain('Write ONLY the section for Phase 1: Engine')
    expect(buildPrdTailPrompt('CTX', OUTLINE)).toContain('Do not write sections 1 to 6')
  })

  it('adds a missing ### Phase heading and keeps an existing one', () => {
    const phase = { index: 2, name: 'Interface' }
    expect(ensurePrdPhaseHeading('Body', phase)).toBe('### Phase 2: Interface\n\nBody')
    const kept = '### Phase 2: Interface\n\nBody'
    expect(ensurePrdPhaseHeading(kept, phase)).toBe(kept)
  })

  it('merged PRD keeps the section order and parses to the same phases', () => {
    const merged = mergePrdParts(
      '# Poker — PRD\n\n## 1. Executive Summary\nText\n\n## 5. Coding Standards\nRules',
      [
        ensurePrdPhaseHeading('Scaffold body', { index: 0, name: 'Scaffold' }),
        ensurePrdPhaseHeading('Engine body', { index: 1, name: 'Engine' }),
      ],
      '## 7. Risk Register\nRisks',
    )
    const order = ['## 1. Executive Summary', '## 5. Coding Standards', '## 6. Implementation Phases', '### Phase 0: Scaffold', '### Phase 1: Engine', '## 7. Risk Register']
    let last = -1
    for (const heading of order) {
      const at = merged.indexOf(heading)
      expect(at).toBeGreaterThan(last)
      last = at
    }
    expect(GraphExpander.parsePhases(merged).map((p) => p.index)).toEqual([0, 1])
  })
})

describe('StageExecutor prd-architect split', () => {
  it('makes outline + head + one call per phase + tail, and merges them in order', async () => {
    const { client, calls } = fakeClient(answerFor)
    const executor = new StageExecutor(client as never)
    const { yielded, returned } = await drain(executor.executeStage('prd-architect', 'USER IDEA', []))

    expect(calls).toHaveLength(1 + 1 + 3 + 1) // outline, head, 3 phases, tail
    expect(yielded).toBe(returned)
    expect(yielded.indexOf('## 1. Executive Summary')).toBeLessThan(yielded.indexOf('## 6. Implementation Phases'))
    expect(yielded.indexOf('### Phase 0: Scaffold')).toBeLessThan(yielded.indexOf('### Phase 2: Interface'))
    expect(yielded.indexOf('### Phase 2: Interface')).toBeLessThan(yielded.indexOf('## 7. Risk Register'))
    expect(yielded).not.toContain('Sets up the project.') // outline text is not in the document
  })

  it('adds up token usage across all calls', async () => {
    const { client } = fakeClient(answerFor)
    const executor = new StageExecutor(client as never)
    await drain(executor.executeStage('prd-architect', 'USER IDEA', []))
    expect(executor.lastUsage!.inputTokens).toBe(200 + 1 * 300 + 3 * 300 + 300)
    expect(executor.lastUsage!.outputTokens).toBe(40 + 1000 + 3 * 1000 + 1000)
  })

  it('fails the stage if a part is cut off at the token limit', async () => {
    const { client } = fakeClient((prompt) =>
      prompt.includes('Write ONLY the section for Phase 1') ? { text: 'partial', stopReason: 'max_tokens' } : answerFor(prompt),
    )
    const executor = new StageExecutor(client as never)
    await expect(drain(executor.executeStage('prd-architect', 'USER IDEA', []))).rejects.toThrow()
  })

  it('falls back to a single call when the outline has no phases', async () => {
    const { client, calls } = fakeClient((prompt) =>
      prompt.includes('PRD OUTLINE ONLY') ? { text: 'nothing here' } : { text: 'whole PRD' },
    )
    const executor = new StageExecutor(client as never)
    const { yielded } = await drain(executor.executeStage('prd-architect', 'USER IDEA', []))
    expect(calls).toHaveLength(2) // outline + the original single call
    expect(yielded).toBe('whole PRD')
  })
})
