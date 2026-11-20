/**
 * Static completeness check for generated code artifacts.
 *
 * Runs on the files extracted from a phase-executor / fix-executor output,
 * before they are saved. It needs no installs and does not run any code.
 *
 * It catches two failures seen in practice:
 *  1. A file whose closing ``` fence is missing (model output cut off mid-file).
 *  2. A relative or "@/" import that points at a file which does not exist
 *     (in this artifact, or already in the project).
 */
import path from 'path';

export interface CheckableFile {
  filePath: string;
  content: string;
  complete?: boolean;
}

export interface CompletenessResult {
  ok: boolean;
  incompleteFiles: string[];
  missingImports: Array<{ from: string; spec: string }>;
  /** The output contained no code files at all (the model wrote a plan or a question instead). */
  noFiles?: boolean;
}

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

// import x from '...' / export x from '...' / import('...') / require('...')
const IMPORT_RE = /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function normalizePath(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '');
}

function resolvesTo(candidate: string, known: Set<string>): boolean {
  if (known.has(candidate)) return true;
  // Import written with a .js suffix that really points at a .ts/.tsx file
  const noJs = candidate.replace(/\.(m|c)?js$|\.jsx$/, '');
  for (const ext of RESOLVE_EXTS) {
    if (known.has(candidate + ext) || known.has(noJs + ext)) return true;
    if (known.has(path.posix.join(candidate, 'index' + ext))) return true;
  }
  return false;
}

export function checkArtifactCompleteness(
  files: CheckableFile[],
  projectPaths: string[] = [],
): CompletenessResult {
  const known = new Set<string>([...projectPaths, ...files.map((f) => f.filePath)].map(normalizePath));
  const incompleteFiles = files.filter((f) => f.complete === false).map((f) => f.filePath);
  const missingImports: Array<{ from: string; spec: string }> = [];
  const noFiles = files.length === 0;

  for (const file of files) {
    const from = normalizePath(file.filePath);
    if (!CODE_EXT.has(path.posix.extname(from))) continue;

    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(file.content)) !== null) {
      const spec = m[1];
      let target: string | null = null;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        target = normalizePath(path.posix.join(path.posix.dirname(from), spec));
      } else if (spec.startsWith('@/')) {
        // Project alias "@/..." maps to the repository root (see tsconfig paths)
        target = normalizePath(spec.slice(2));
      } else {
        continue; // bare package names cannot be checked without installing
      }
      if (!resolvesTo(target, known)) {
        missingImports.push({ from, spec });
      }
    }
  }

  return {
    ok: !noFiles && incompleteFiles.length === 0 && missingImports.length === 0,
    incompleteFiles,
    missingImports,
    noFiles,
  };
}

/** Feedback text sent back to the model when the check fails. */
export function completenessFeedback(result: CompletenessResult): string {
  const lines: string[] = ['OUTPUT INCOMPLETE OR INCONSISTENT. Regenerate the full output and fix the following:'];
  if (result.noFiles) {
    lines.push(
      '- Your output contained NO code files. Do not ask questions or describe a plan. ' +
      'Write the complete code now: every file in full, in a code block with its path on the fence line (e.g. ```typescript:src/app.ts).',
    );
  }
  for (const f of result.incompleteFiles) {
    lines.push(`- File "${f}" was cut off before its closing code fence. Output the complete file.`);
  }
  for (const m of result.missingImports) {
    lines.push(`- "${m.from}" imports "${m.spec}", but no such file exists in the output. Create that file or fix the import.`);
  }
  return lines.join('\n');
}
