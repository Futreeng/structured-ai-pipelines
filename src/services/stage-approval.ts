/**
 * Guard for approving a stage. A stage can only be approved once it has output.
 * Without this, a stage whose model call was cut off (for example by the 300-second
 * route limit) could be approved with nothing in it, and the stages after it would
 * run on empty input.
 */
/** Starts the placeholder output of a stage the budget guard refused to run. */
export const BUDGET_EXCEEDED_MARKER = '**Budget Exceeded**';

export interface ApprovableStage {
  displayName: string;
  status: string;
  artifactContent: string | null;
}

export function assertStageApprovable(stage: ApprovableStage, editedContent?: string): void {
  if (stage.status === 'running' || stage.status === 'pending') {
    throw new Error(
      `Cannot approve "${stage.displayName}" while it is ${stage.status}. Wait for it to finish, or rerun it.`,
    );
  }
  // The budget guard refused to run this stage, so its "output" is only an explanation.
  // Approving it (the page does this automatically in auto-approve mode) would send empty
  // work on to the stages after it and report the run as completed.
  if (editedContent === undefined && (stage.artifactContent ?? '').startsWith(BUDGET_EXCEEDED_MARKER)) {
    throw new Error(
      `"${stage.displayName}" did not run because the budget limit was reached. ` +
      'Raise FORGE_RUN_BUDGET_USD (or FORGE_DAILY_BUDGET_USD), then reject the stage to run it again.',
    );
  }

  const hasOutput = (editedContent ?? stage.artifactContent ?? '').trim().length > 0;
  if (!hasOutput) {
    throw new Error(
      `Cannot approve "${stage.displayName}": it has no output. It was probably cut off before it finished. Rerun the stage.`,
    );
  }
}
