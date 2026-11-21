import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/prisma', () => import('./__mocks__/prisma'))

import { CIGenerator } from '../src/services/ci-generator'
import { DockerfileGenerator } from '../src/services/dockerfile-generator'
import { TestGenerator } from '../src/services/test-generator'

// Component sources copied from a real generated project (the "Focus Garden" run).
const TASK_BOX = `interface TaskBoxProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

export default function TaskBox({ value, onChange, disabled }: TaskBoxProps) {
  return <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}
`

const GARDEN = `import type { PlantKind } from '../types';

interface GardenProps {
  garden: (PlantKind | null)[];
}

export default function Garden({ garden }: GardenProps) {
  return <div>{garden.length}</div>;
}
`

const TIMER = `import type { Mode, TimerStatus } from '../types';

interface TimerProps {
  mode: Mode;
  status: TimerStatus;
  remainingMs: number;
  onStart: () => void;
}

export default function Timer({
  mode,
  status,
  remainingMs,
  onStart,
}: TimerProps) {
  return <button onClick={onStart}>{mode}{status}{remainingMs}</button>;
}
`

const PLANT_SPRITE = `export default function PlantSprite({ kind }: { kind: PlantKind }) {
  return <svg data-kind={kind} />;
}
`

const NO_PROPS = `export default function Widget() {
  return <p>hi</p>;
}
`

const RETURNS_NULL = `interface Props { show: boolean }
export default function Maybe({ show }: Props) {
  if (!show) return null;
  return <p>shown</p>;
}
`

describe('generated component tests', () => {
  it('passes every required prop when each one has a simple type', () => {
    const out = TestGenerator.componentTest('TaskBox', './TaskBox', TASK_BOX)
    expect(out).toContain("const props = { value: '', onChange: () => {}, disabled: false };")
    expect(out).toContain('render(<TaskBox {...props} />)')
    expect(out).not.toMatch(/render\(<TaskBox \/>\)/) // the old prop-less render failed tsc
  })

  it('builds an empty array for an array prop', () => {
    const out = TestGenerator.componentTest('Garden', './Garden', GARDEN)
    expect(out).toContain('const props = { garden: [] };')
  })

  it('renders a component that takes no props without a props object', () => {
    const out = TestGenerator.componentTest('Widget', './Widget', NO_PROPS)
    expect(out).toContain('render(<Widget />)')
    expect(out).not.toContain('const props')
  })

  it('only checks that the module loads when a prop has a custom type it cannot build', () => {
    const out = TestGenerator.componentTest('Timer', './Timer', TIMER)
    expect(out).toContain("expect(typeof Timer).toBe('function')")
    expect(out).toContain('only checks that the component loads')
    expect(out).not.toContain('render(')
  })

  it('does the same when the props are an inline type it cannot read', () => {
    const out = TestGenerator.componentTest('PlantSprite', './PlantSprite', PLANT_SPRITE)
    expect(out).toContain("expect(typeof PlantSprite).toBe('function')")
  })

  it('skips the "in the document" check for a component that can render nothing', () => {
    const out = TestGenerator.componentTest('Maybe', './Maybe', RETURNS_NULL)
    expect(out).toContain('const props = { show: false };')
    expect(out).toContain('renders without crashing')
    expect(out).not.toContain('toBeInTheDocument')
  })

  it('never imports `screen`, which the generated tsconfig (noUnusedLocals) rejects', () => {
    for (const [name, src] of [['TaskBox', TASK_BOX], ['Garden', GARDEN], ['Timer', TIMER], ['Widget', NO_PROPS]]) {
      expect(TestGenerator.componentTest(name, `./${name}`, src)).not.toContain('screen')
    }
  })

  it('registers jest-dom through the vitest entry so toBeInTheDocument type-checks', () => {
    const { configFiles, files } = TestGenerator.scaffold(
      [{ filePath: 'src/components/TaskBox.tsx', content: TASK_BOX }],
      'node',
    )
    expect(configFiles.find((f) => f.filePath === 'src/test/setup.ts')?.content).toContain(
      "import '@testing-library/jest-dom/vitest';",
    )
    expect(files.find((f) => f.filePath === 'src/components/TaskBox.test.tsx')?.content).toContain('{...props}')
  })
})

describe('sampleValueForType', () => {
  it.each([
    ['string', "''"],
    ['number', '0'],
    ['boolean', 'false'],
    ['() => void', '() => {}'],
    ['(value: string) => void', '() => {}'],
    ['(PlantKind | null)[]', '[]'],
    ['Array<string>', '[]'],
    ["'focus' | 'break'", "'focus'"],
    ['string | null', 'null'],
    ['React.ReactNode', 'null'],
    ['Record<string, number>', '{}'],
  ])('%s -> %s', (type, expected) => {
    expect(TestGenerator.sampleValueForType(type)).toBe(expected)
  })

  it.each(['Mode', 'Stats', 'SessionRecord', 'Map<string, number>'])('%s -> null (cannot be built automatically)', (type) => {
    expect(TestGenerator.sampleValueForType(type)).toBeNull()
  })
})

describe('generated Dockerfile', () => {
  const viteProject = [
    { filePath: 'package.json', content: JSON.stringify({ scripts: { build: 'vite build' } }) },
    { filePath: 'vite.config.ts', content: 'export default {}' },
  ]
  const dockerfile = (files: typeof viteProject) =>
    DockerfileGenerator.generate(files, { projectType: 'node', projectName: 'My App' }).files.find(
      (f) => f.filePath === 'Dockerfile',
    )!.content

  it('uses a valid COPY for nginx.conf (a Dockerfile COPY cannot take shell redirection)', () => {
    const out = dockerfile(viteProject)
    expect(out).toContain('COPY nginx.conf /etc/nginx/conf.d/default.conf\n')
    expect(out).not.toContain('2>/dev/null')
    expect(out).not.toContain('|| true')
  })

  it('also generates the nginx.conf that the Dockerfile copies', () => {
    const result = DockerfileGenerator.generate(viteProject, { projectType: 'node', projectName: 'x' })
    expect(result.files.some((f) => f.filePath === 'nginx.conf')).toBe(true)
  })

  it('uses npm install when the project has no package-lock.json, npm ci when it does', () => {
    expect(dockerfile(viteProject)).toContain('RUN npm install')
    expect(dockerfile(viteProject)).not.toContain('npm ci')
    expect(dockerfile([...viteProject, { filePath: 'package-lock.json', content: '{}' }])).toContain('RUN npm ci')
  })

  it('builds on Node 24, not the end-of-life Node 20', () => {
    expect(dockerfile(viteProject)).toContain('FROM node:24-slim')
    expect(dockerfile(viteProject)).not.toContain('node:20')
  })

  it('applies the same install and Node rules to a server-side Node app', () => {
    const server = [{ filePath: 'package.json', content: JSON.stringify({ scripts: { start: 'node index.js' } }) }]
    const out = dockerfile(server as typeof viteProject)
    expect(out).toContain('RUN npm install')
    expect(out).toContain('FROM node:24-slim')
  })
})

describe('generated CI workflow', () => {
  const ci = (files: Array<{ filePath: string; content: string }>) =>
    CIGenerator.generate(files, 'node', 'my-app').files[0].content
  const pkg = { filePath: 'package.json', content: JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' } }) }

  it('does not use npm ci or the npm cache when there is no lockfile (both fail without one)', () => {
    const out = ci([pkg])
    expect(out).toContain('run: npm install')
    expect(out).not.toContain('npm ci')
    expect(out).not.toContain("cache: 'npm'")
  })

  it('uses npm ci and the cache when a lockfile exists', () => {
    const out = ci([pkg, { filePath: 'package-lock.json', content: '{}' }])
    expect(out).toContain('run: npm ci')
    expect(out).toContain("cache: 'npm'")
  })

  it('runs on Node 24 with current action versions', () => {
    const out = ci([pkg])
    expect(out).toContain("node-version: '24'")
    expect(out).toContain('actions/checkout@v5')
    expect(out).toContain('actions/setup-node@v5')
    expect(out).not.toContain('actions/checkout@v4')
    expect(out).not.toContain("node-version: '20'")
  })

  it('still builds and tests', () => {
    const out = ci([pkg])
    expect(out).toContain('npm run build')
    expect(out).toContain('npm test')
  })
})
