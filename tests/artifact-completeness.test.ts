import { describe, expect, it } from 'vitest'
import { checkArtifactCompleteness, completenessFeedback } from '@/src/services/artifact-completeness'
import { extractFilesFromArtifact } from '@/src/services/file-manager'

describe('extractFilesFromArtifact completeness flag', () => {
  it('marks a file cut off before its closing fence as incomplete', () => {
    const artifact = '```ts:src/a.ts\nexport const a = 1;\nexport const b ='
    const files = extractFilesFromArtifact(artifact)
    expect(files).toHaveLength(1)
    expect(files[0].complete).toBe(false)
  })

  it('marks a closed file as complete', () => {
    const artifact = '```ts:src/a.ts\nexport const a = 1;\n```\n'
    const files = extractFilesFromArtifact(artifact)
    expect(files[0].complete).toBe(true)
  })
})

describe('checkArtifactCompleteness', () => {
  it('passes a complete artifact whose imports all resolve', () => {
    const files = [
      { filePath: 'src/lib/util.ts', content: 'export const x = 1' },
      { filePath: 'src/app.ts', content: "import { x } from './lib/util'\nconsole.log(x)" },
    ]
    expect(checkArtifactCompleteness(files).ok).toBe(true)
  })

  it('flags a file that was cut off', () => {
    const files = [{ filePath: 'src/a.ts', content: 'export const b =', complete: false }]
    const result = checkArtifactCompleteness(files)
    expect(result.ok).toBe(false)
    expect(result.incompleteFiles).toEqual(['src/a.ts'])
  })

  it('flags a relative import of a file that does not exist', () => {
    const files = [{ filePath: 'src/app.ts', content: "import { x } from './lib/missing'" }]
    const result = checkArtifactCompleteness(files)
    expect(result.ok).toBe(false)
    expect(result.missingImports).toEqual([{ from: 'src/app.ts', spec: './lib/missing' }])
  })

  it('accepts an import of a file that already exists in the project', () => {
    const files = [{ filePath: 'src/app.ts', content: "import { x } from './lib/util'" }]
    expect(checkArtifactCompleteness(files, ['src/lib/util.ts']).ok).toBe(true)
  })

  it('resolves the @/ alias to the repository root', () => {
    const files = [
      { filePath: 'src/app.tsx', content: "import { Btn } from '@/components/Btn'" },
      { filePath: 'components/Btn.tsx', content: 'export const Btn = () => null' },
    ]
    expect(checkArtifactCompleteness(files).ok).toBe(true)
  })

  it('resolves a .js import to a .ts file', () => {
    const files = [
      { filePath: 'src/app.ts', content: "import { b } from './b.js'" },
      { filePath: 'src/b.ts', content: 'export const b = 1' },
    ]
    expect(checkArtifactCompleteness(files).ok).toBe(true)
  })

  it('ignores bare package imports, which need an install to check', () => {
    const files = [{ filePath: 'src/app.ts', content: "import React from 'react'" }]
    expect(checkArtifactCompleteness(files).ok).toBe(true)
  })

  it('fails when the output contains no files at all (a plan or a question instead of code)', () => {
    const result = checkArtifactCompleteness([])
    expect(result.ok).toBe(false)
    expect(result.noFiles).toBe(true)
    expect(completenessFeedback(result)).toContain('NO code files')
  })

  it('builds feedback that names the cut-off file and the missing import', () => {
    const text = completenessFeedback({
      ok: false,
      incompleteFiles: ['src/a.ts'],
      missingImports: [{ from: 'src/app.ts', spec: './lib/missing' }],
    })
    expect(text).toContain('src/a.ts')
    expect(text).toContain('./lib/missing')
  })
})
