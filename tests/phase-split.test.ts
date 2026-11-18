import { describe, expect, it } from 'vitest'
import { GraphExpander } from '@/src/services/graph-expander'
import {
  buildPhasePrompt,
  ensurePhaseHeading,
  mergePhaseSections,
  MAX_PHASES,
  parseOutline,
  runWithConcurrency,
} from '@/src/services/phase-split'

describe('parseOutline', () => {
  it('reads each heading as a phase, in order', () => {
    const outline = [
      '## Phase 0: Project Scaffolding',
      'Sets up the repo.',
      '',
      '## Phase 1: Core Game Logic',
      'Deals cards and tracks bets.',
    ].join('\n')
    expect(parseOutline(outline)).toEqual([
      { index: 0, name: 'Project Scaffolding' },
      { index: 1, name: 'Core Game Logic' },
    ])
  })

  it('accepts ### and em-dash headings', () => {
    expect(parseOutline('### Phase 2 — UI Components')).toEqual([{ index: 2, name: 'UI Components' }])
  })

  it('ignores duplicate phase numbers and non-heading lines', () => {
    const outline = ['intro text', '## Phase 1: A', '## Phase 1: A again', '## Phase 2: B'].join('\n')
    expect(parseOutline(outline)).toEqual([
      { index: 1, name: 'A' },
      { index: 2, name: 'B' },
    ])
  })

  it('returns an empty list when there are no phase headings', () => {
    expect(parseOutline('Here is some prose with no headings.')).toEqual([])
  })
})

describe('the outline and the per-phase sections feed the existing parser', () => {
  it('merged sections parse back into the same phases', () => {
    const phases = [
      { index: 0, name: 'Scaffold' },
      { index: 1, name: 'Engine' },
      { index: 2, name: 'UI' },
    ]
    const sections = phases.map((p) =>
      ensurePhaseHeading(`Body text for ${p.name}.\n\nMore detail.`, p),
    )
    const merged = mergePhaseSections(sections)
    const parsed = GraphExpander.parsePhases(merged)
    expect(parsed.map((p) => [p.index, p.name])).toEqual([
      [0, 'Scaffold'],
      [1, 'Engine'],
      [2, 'UI'],
    ])
  })
})

describe('ensurePhaseHeading', () => {
  it('keeps a section that already starts with its heading', () => {
    const text = '## Phase 1: Engine\n\nBody'
    expect(ensurePhaseHeading(text, { index: 1, name: 'Engine' })).toBe(text)
  })

  it('adds the heading when the model left it out', () => {
    expect(ensurePhaseHeading('Body only', { index: 3, name: 'Deploy' })).toBe('## Phase 3: Deploy\n\nBody only')
  })
})

describe('buildPhasePrompt', () => {
  it('asks for exactly one phase and includes the outline', () => {
    const prompt = buildPhasePrompt('PRD TEXT', '## Phase 0: A\n## Phase 1: B', { index: 1, name: 'B' })
    expect(prompt).toContain('PRD TEXT')
    expect(prompt).toContain('## Phase 0: A')
    expect(prompt).toContain('Write ONLY the complete section for Phase 1: B')
    expect(prompt).toContain('Start with the heading "## Phase 1: B"')
  })
})

describe('runWithConcurrency', () => {
  it('keeps results in input order even when tasks finish out of order', async () => {
    const out = await runWithConcurrency([30, 10, 20], 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms))
      return ms
    })
    expect(out).toEqual([30, 10, 20])
  })

  it('never runs more than the limit at once', async () => {
    let inFlight = 0
    let peak = 0
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('rejects when a task fails', async () => {
    await expect(
      runWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })
})

describe('limits', () => {
  it('caps the phase count at 10', () => {
    expect(MAX_PHASES).toBe(10)
  })
})
