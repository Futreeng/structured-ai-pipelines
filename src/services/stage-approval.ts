/**
 * Guard for approving a stage. A stage can only be approved once it has output.
 * Without this, a stage whose model call was cut off (for example by the 300-second
 * route limit) could be approved with nothing in it, and the stages after it would
 * run on empty input.
 */
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
  const hasOutput = (editedContent ?? stage.artifactContent ?? '').trim().length > 0;
  if (!hasOutput) {
    throw new Error(
      `Cannot approve "${stage.displayName}": it has no output. It was probably cut off before it finished. Rerun the stage.`,
    );
  }
}
