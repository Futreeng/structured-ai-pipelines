/**
 * Helpers for splitting the prd-architect ("Generate PRD") stage into several model
 * calls, so one response never has to hold the whole PRD.
 *
 * The PRD has a fixed structure (see .claude/skills/prd-architect/SKILL.md):
 *   title, sections 1-5, section 6 (one "### Phase N" block per phase), sections 7-9.
 *
 * Flow (orchestrated by StageExecutor.executePrdSplit):
 *   1. Outline call: the list of implementation phases only.
 *   2. Head call: title and sections 1-5.
 *   3. One call per phase in section 6.
 *   4. Tail call: sections 7-9.
 *   The parts are joined in order into the same document layout as before.
 */
import { type OutlinePhase } from '@/src/services/phase-split';

const PHASE_HEADING_RE = /^#{2,4}\s*Phase\s+(\d+)\s*[:\-—–]/i;

export function buildPrdOutlineInstruction(maxPhases: number): string {
  return [
    'PRD OUTLINE ONLY. Do not write any section content yet.',
    'Output only the implementation phases of the PRD, one heading line per phase, in order, in exactly this form:',
    '### Phase <number>: <short name>',
    'Under each heading write one sentence describing the phase.',
    `Use between 2 and ${maxPhases} phases.`,
  ].join('\n');
}

export function buildPrdHeadPrompt(context: string, outlineText: string): string {
  return [
    context,
    '',
    '## Implementation phases (for reference; do not reproduce them)',
    outlineText.trim(),
    '',
    'Write ONLY the document from the title through section 5 ("## 5. Coding Standards (Project-Specific)"), in the format your instructions require.',
    'Do not write section 6 or any later section.',
  ].join('\n');
}

export function buildPrdPhasePrompt(context: string, outlineText: string, phase: OutlinePhase): string {
  return [
    context,
    '',
    '## Implementation phases (for reference; do not reproduce them)',
    outlineText.trim(),
    '',
    `Write ONLY the section for Phase ${phase.index}: ${phase.name}, which sits under "## 6. Implementation Phases".`,
    `Start with the heading "### Phase ${phase.index}: ${phase.name}" and write it in the format of the Phase section of your instructions.`,
    'Do not write other phases or any other section.',
  ].join('\n');
}

export function buildPrdTailPrompt(context: string, outlineText: string): string {
  return [
    context,
    '',
    '## Implementation phases (for reference; do not reproduce them)',
    outlineText.trim(),
    '',
    'Write ONLY sections 7 through 9, from "## 7. Risk Register" to the end of the document, in the format your instructions require.',
    'Do not write sections 1 to 6.',
  ].join('\n');
}

/** Add the "### Phase N: Name" heading if the model left it out. */
export function ensurePrdPhaseHeading(sectionText: string, phase: OutlinePhase): string {
  const text = sectionText.trim();
  const hasHeading = text.split('\n').some((line) => {
    const m = line.trim().match(PHASE_HEADING_RE);
    return !!m && parseInt(m[1], 10) === phase.index;
  });
  return hasHeading ? text : `### Phase ${phase.index}: ${phase.name}\n\n${text}`;
}

export function mergePrdParts(head: string, phaseSections: string[], tail: string): string {
  return [
    head.trim(),
    '## 6. Implementation Phases',
    ...phaseSections.map((s) => s.trim()),
    tail.trim(),
  ].join('\n\n');
}
