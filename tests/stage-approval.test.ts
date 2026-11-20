import { describe, expect, it } from 'vitest'
import { assertStageApprovable } from '@/src/services/stage-approval'

const base = { displayName: 'Phase 0: Scaffold — Prompts', status: 'awaiting_approval', artifactContent: 'Prompt text' }

describe('assertStageApprovable', () => {
  it('allows approving a finished stage with output', () => {
    expect(() => assertStageApprovable(base)).not.toThrow()
  })

  it('refuses a stage with no output (the cut-off case)', () => {
    expect(() => assertStageApprovable({ ...base, artifactContent: null })).toThrow(/has no output/)
    expect(() => assertStageApprovable({ ...base, artifactContent: '   ' })).toThrow(/has no output/)
  })

  it('refuses a running or pending stage', () => {
    expect(() => assertStageApprovable({ ...base, status: 'running' })).toThrow(/while it is running/)
    expect(() => assertStageApprovable({ ...base, status: 'pending' })).toThrow(/while it is pending/)
  })

  it('accepts edited content when the stored output is empty', () => {
    expect(() => assertStageApprovable({ ...base, artifactContent: null }, 'Edited text')).not.toThrow()
  })

  it('refuses empty edited content', () => {
    expect(() => assertStageApprovable(base, '  ')).toThrow(/has no output/)
  })
})
