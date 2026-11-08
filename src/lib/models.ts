/**
 * Claude model and effort settings, in one place.
 *
 * Override the models per deployment with CLAUDE_MAIN_MODEL / CLAUDE_FAST_MODEL
 * (e.g. CLAUDE_MAIN_MODEL=claude-opus-5-5 for the hardest pipelines).
 * Use exact model IDs from https://platform.claude.com/docs/en/about-claude/models —
 * current IDs have no date suffix.
 */
export const CLAUDE_MODELS = {
  /** Pipeline stages: planning, scaffolding, code generation, review. */
  main: process.env.CLAUDE_MAIN_MODEL || 'claude-sonnet-5-5',
  /** High-volume, short-output agents (votes, classification). */
  fast: process.env.CLAUDE_FAST_MODEL || 'claude-haiku-5-5',
} as const;

/**
 * Effort controls how much the model thinks (Claude 5 models think by default,
 * and thinking counts toward max_tokens). Lower effort = fewer tokens, faster.
 */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT = {
  /** Multi-step generation and agentic coding work. */
  pipeline: 'medium',
  /** Short structured answers (JSON votes, triage, checks). */
  quick: 'low',
} as const satisfies Record<string, ClaudeEffort>;

/** Thrown when Claude declines a request (stop_reason "refusal"). */
export class ClaudeRefusalError extends Error {
  readonly category: string | null;

  constructor(category: string | null, explanation?: string | null) {
    super(
      `Claude declined this request${category ? ` (category: ${category})` : ''}` +
        (explanation ? `: ${explanation}` : '. Try rephrasing the input.'),
    );
    this.name = 'ClaudeRefusalError';
    this.category = category;
  }
}

/** Throw ClaudeRefusalError if a response was a refusal; otherwise do nothing. */
export function assertNotRefused(response: {
  stop_reason?: string | null;
  stop_details?: unknown;
}): void {
  if (response.stop_reason !== 'refusal') return;
  const details = (response.stop_details ?? null) as { category?: string | null; explanation?: string | null } | null;
  throw new ClaudeRefusalError(details?.category ?? null, details?.explanation ?? null);
}
