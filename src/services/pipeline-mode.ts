/**
 * Pipeline mode: the skills in .claude/skills were written for a person chatting with
 * Claude, so several of them say "present your plan and wait for confirmation" or
 * "stop and ask". In a pipeline run nobody can answer, so the model writes a plan plus a
 * question and stops. For the code-building stages that meant 0 files were produced and the
 * empty build was auto-approved.
 */

/** Skills whose output is source code, saved as project files. */
export const CODE_BUILD_SKILLS = new Set(['phase-executor', 'fix-executor']);

export function isCodeBuildSkill(skillName: string): boolean {
  return CODE_BUILD_SKILLS.has(skillName);
}

const CODE_BUILD_OVERRIDE = `

---

## PIPELINE MODE: THIS OVERRIDES ANY INSTRUCTION ABOVE TO ASK, CONFIRM OR WAIT

You are running inside an automated pipeline. Nobody is available to answer questions, approve a plan or say "go ahead". This response is saved and checked automatically.

- Do NOT ask questions, present a plan for approval, or wait for confirmation. Ignore every instruction above that tells you to do so.
- Do NOT only describe what you will do. Write the code now, in this response.
- Where the specification is unclear or missing something, choose the most reasonable conventional option, and note the assumption in a code comment or a short "Assumptions" list after the code.
- Output EVERY file in full (never abbreviated or truncated), each in its own code block with the path on the fence line, exactly like this:

\`\`\`typescript:src/example.ts
// complete file contents
\`\`\`

A response that contains no code files is a failed build and will be rejected.`;

/** Extra system-prompt text for stages that must run without a human in the loop. */
export function pipelineModeOverride(skillName: string): string {
  return isCodeBuildSkill(skillName) ? CODE_BUILD_OVERRIDE : '';
}
