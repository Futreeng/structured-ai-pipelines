/**
 * Execution gate: writes a generated project to a temp folder, installs it, and runs
 * its build and test scripts. A stage that fails this gate is sent back for regeneration.
 *
 * Opt-in: runs only when EXECUTION_GATE=1. It needs a machine that can run npm for
 * several minutes (a local or self-hosted server). It cannot run inside a Vercel
 * serverless request, so leave the flag unset there.
 */
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export interface GateFile {
  filePath: string;
  content: string;
}

export interface GateStep {
  name: string;
  ok: boolean;
  output: string;
}

export interface GateResult {
  passed: boolean;
  skipped: boolean;
  steps: GateStep[];
}

const INSTALL_TIMEOUT_MS = 300_000;
const SCRIPT_TIMEOUT_MS = 180_000;

export function executionGateEnabled(): boolean {
  return process.env.EXECUTION_GATE === '1';
}

/** Only plain relative paths inside the temp folder are allowed. */
function safeRelative(filePath: string): string | null {
  const n = path.posix.normalize(filePath.replace(/\\/g, '/'));
  if (path.posix.isAbsolute(n) || n === '..' || n.startsWith('../')) return null;
  return n;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        shell: process.platform === 'win32', // npm is npm.cmd on Windows
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim();
        // Keep the tail: the error is almost always at the end of the log.
        resolve({ ok: !err, output: output.slice(-4000) });
      },
    );
  });
}

export async function runExecutionGate(files: GateFile[]): Promise<GateResult> {
  if (!executionGateEnabled()) {
    return { passed: true, skipped: true, steps: [] };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'gate-'));
  try {
    for (const file of files) {
      const rel = safeRelative(file.filePath);
      if (!rel) continue;
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, file.content, 'utf8');
    }

    const pkgPath = path.join(dir, 'package.json');
    if (!existsSync(pkgPath)) {
      return { passed: true, skipped: true, steps: [{ name: 'detect', ok: true, output: 'No package.json in output; gate skipped' }] };
    }

    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(await readFile(pkgPath, 'utf8')).scripts ?? {};
    } catch (err) {
      return {
        passed: false,
        skipped: false,
        steps: [{ name: 'package.json', ok: false, output: `package.json is not valid JSON: ${(err as Error).message}` }],
      };
    }

    const steps: GateStep[] = [];
    const install = await runCommand('npm', ['install', '--no-audit', '--no-fund'], dir, INSTALL_TIMEOUT_MS);
    steps.push({ name: 'npm install', ...install });
    if (!install.ok) return { passed: false, skipped: false, steps };

    if (scripts.build) {
      const build = await runCommand('npm', ['run', 'build'], dir, SCRIPT_TIMEOUT_MS);
      steps.push({ name: 'npm run build', ...build });
      if (!build.ok) return { passed: false, skipped: false, steps };
    }

    // Skip npm's placeholder "no test specified" script.
    if (scripts.test && !/no test specified/i.test(scripts.test)) {
      const test = await runCommand('npm', ['test'], dir, SCRIPT_TIMEOUT_MS);
      steps.push({ name: 'npm test', ...test });
      if (!test.ok) return { passed: false, skipped: false, steps };
    }

    return { passed: true, skipped: false, steps };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Feedback text sent back to the model when a gate step fails. */
export function executionFeedback(result: GateResult): string {
  const failed = result.steps.find((s) => !s.ok);
  return [
    'EXECUTION FAILED. The generated project did not pass its own build or tests.',
    failed ? `Failing step: ${failed.name}` : '',
    failed ? `Output (tail):\n${failed.output}` : '',
    'Fix the code so that install, build and tests pass, and output the complete project again.',
  ].filter(Boolean).join('\n\n');
}
