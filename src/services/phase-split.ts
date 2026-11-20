/**
 * Helpers for splitting the phase-builder ("Split PRD into Phases") stage into
 * one model call per phase, instead of one call that must hold every phase.
 *
 * Why: a single response is capped by DOCUMENT_MAX_TOKENS. A PRD with many phases
 * can exceed that cap, and the stage then fails with "cut off at the token limit".
 *
 * Flow (orchestrated by StageExecutor.executeStage):
 *   1. Outline call: the phase list only (heading + one sentence per phase).
 *   2. One call per phase: the full section for that phase only.
 *   3. The sections are joined in order into the same artifact format as before,
 *      so GraphExpander.parsePhases and everything downstream stay unchanged.
 */

export const MAX_PHASES = 10;
export const PHASE_CONCURRENCY = 6;

export interface OutlinePhase {
  index: number;
  name: string;
}

const HEADING_RE = /^#{1,4}\s*Phase\s+(\d+)\s*[:\-—–]\s*(.+)$/i;

export function buildOutlineInstruction(): string {
  return [
    'PHASE OUTLINE ONLY. Do not write any phase content yet.',
    'Output one heading line per phase, in order, in exactly this form:',
    '## Phase <number>: <short name>',
    'Under each heading write one sentence describing the phase.',
    `Use between 2 and ${MAX_PHASES} phases.`,
  ].join('\n');
}

/** Parse the outline. Returns [] if no phase headings are found. */
export function parseOutline(outlineText: string): OutlinePhase[] {
  const phases: OutlinePhase[] = [];
  const seen = new Set<number>();
  for (const line of outlineText.split('\n')) {
    const m = line.trim().match(HEADING_RE);
    if (!m) continue;
    const index = parseInt(m[1], 10);
    if (seen.has(index)) continue;
    seen.add(index);
    phases.push({ index, name: m[2].trim() });
  }
  return phases;
}

export function buildPhasePrompt(context: string, outlineText: string, phase: OutlinePhase): string {
  return [
    context,
    '',
    '## Phase outline (for reference; do not reproduce it)',
    outlineText.trim(),
    '',
    `Write ONLY the complete section for Phase ${phase.index}: ${phase.name}, in the format your instructions require.`,
    `Start with the heading "## Phase ${phase.index}: ${phase.name}". Do not write any other phase.`,
  ].join('\n');
}

/**
 * Make sure a phase section starts with its heading. The model is asked for this,
 * but if it leaves the heading out, add it so the parser can still find the phase.
 */
export function ensurePhaseHeading(sectionText: string, phase: OutlinePhase): string {
  const text = sectionText.trim();
  const hasHeading = text.split('\n').some((line) => {
    const m = line.trim().match(HEADING_RE);
    return !!m && parseInt(m[1], 10) === phase.index;
  });
  return hasHeading ? text : `## Phase ${phase.index}: ${phase.name}\n\n${text}`;
}

export function mergePhaseSections(sections: string[]): string {
  return sections.map((s) => s.trim()).join('\n\n---\n\n');
}

/** Run tasks with at most `limit` in flight. Results keep the input order. */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * For a Prompts stage: keep the heading list of all phases (so cross-phase references
 * still make sense) and the full text of only the phase being prompted. If the phase
 * cannot be found, return the artifact unchanged.
 */
export function extractPhaseForPrompts(artifact: string, phaseIndex: number): string {
  const lines = artifact.split('\n');
  const blocks: Array<{ index: number; heading: string; body: string[] }> = [];
  let current: { index: number; heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const m = line.trim().match(HEADING_RE);
    if (m) {
      current = { index: parseInt(m[1], 10), heading: line.trim(), body: [line] };
      blocks.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }

  const target = blocks.find((b) => b.index === phaseIndex);
  if (!target || blocks.length < 2) return artifact;

  const outline = blocks.map((b) => b.heading).join('\n');
  return `## Phase outline (all phases, for reference)\n${outline}\n\n${target.body.join('\n').trim()}`;
}
