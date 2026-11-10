-- Backfill: tables, columns, indexes and foreign keys that are in schema.prisma
-- but were never captured in a migration (they were applied with `prisma db push`).
-- Without this, `prisma migrate deploy` on an empty database fails at
-- 20260427000000_add_forge_stage_data, because "ForgeRun" doesn't exist yet.
--
-- Generated with `prisma migrate diff --from-migrations <migrations before this one>
-- --to-schema prisma/schema.prisma`, minus ForgeRun."stageData" (added by the next migration).
--
-- Databases that already have these tables (built with `db push`): mark it applied
-- instead of running it:
--   npx prisma migrate resolve --applied 20260420000000_add_missing_tables

-- DropForeignKey
ALTER TABLE "ProjectFile" DROP CONSTRAINT "ProjectFile_createdByStage_fkey";

-- AlterTable
ALTER TABLE "PipelineMetric" ADD COLUMN     "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- AlterTable
ALTER TABLE "PipelineRun" ADD COLUMN     "autoApprove" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProjectFile" ALTER COLUMN "runId" DROP NOT NULL,
ALTER COLUMN "createdByStage" DROP NOT NULL;

-- CreateTable
CREATE TABLE "LearningEntry" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "sourceAgent" TEXT NOT NULL,
    "targetAgent" TEXT NOT NULL,
    "rejectionCount" INTEGER NOT NULL DEFAULT 1,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "runId" TEXT,
    "stageId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "LearningEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidenceScore" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reasoning" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfidenceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletenessCheck" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "phaseIndex" INTEGER NOT NULL,
    "totalCriteria" INTEGER NOT NULL,
    "passedCriteria" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "failures" JSONB NOT NULL DEFAULT '[]',
    "filesChecked" INTEGER NOT NULL DEFAULT 0,
    "importsResolved" BOOLEAN NOT NULL DEFAULT false,
    "appLaunchable" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletenessCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFeedback" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "workedOutOfBox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "pipelineType" TEXT NOT NULL,
    "executionPlan" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stage" TEXT,
    "repoUrl" TEXT NOT NULL,
    "branchName" TEXT,
    "continuous" BOOLEAN NOT NULL DEFAULT false,
    "socraticQuestion" TEXT,
    "socraticAnswer" TEXT,
    "specContent" TEXT,
    "specFilename" TEXT,
    "bugDescription" TEXT,
    "prdTitle" TEXT,
    "prdSummary" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ForgeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeRunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeRunDiff" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "lintPassed" BOOLEAN NOT NULL DEFAULT false,
    "testsPassed" BOOLEAN NOT NULL DEFAULT false,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeRunDiff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeRunDiagnosis" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "affectedFiles" JSONB NOT NULL,
    "fixPlan" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeRunDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeRunResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "mrUrl" TEXT NOT NULL,
    "mrIid" INTEGER NOT NULL,
    "branch" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeRunResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeLessonLearned" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "phase" INTEGER NOT NULL,
    "phaseName" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "fix" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "preventionRule" TEXT NOT NULL,
    "language" TEXT,
    "framework" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeLessonLearned_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningEntry_targetAgent_status_idx" ON "LearningEntry"("targetAgent", "status");

-- CreateIndex
CREATE INDEX "LearningEntry_pattern_idx" ON "LearningEntry"("pattern");

-- CreateIndex
CREATE INDEX "ConfidenceScore_runId_idx" ON "ConfidenceScore"("runId");

-- CreateIndex
CREATE INDEX "ConfidenceScore_stageId_idx" ON "ConfidenceScore"("stageId");

-- CreateIndex
CREATE INDEX "CompletenessCheck_runId_phaseIndex_idx" ON "CompletenessCheck"("runId", "phaseIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "ProjectFeedback_projectId_idx" ON "ProjectFeedback"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFeedback_userId_idx" ON "ProjectFeedback"("userId");

-- CreateIndex
CREATE INDEX "SpecCache_inputHash_idx" ON "SpecCache"("inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "SpecCache_userId_inputHash_key" ON "SpecCache"("userId", "inputHash");

-- CreateIndex
CREATE INDEX "ForgeRun_userId_createdAt_idx" ON "ForgeRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ForgeRunLog_runId_createdAt_idx" ON "ForgeRunLog"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForgeRunDiff_runId_key" ON "ForgeRunDiff"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ForgeRunDiagnosis_runId_key" ON "ForgeRunDiagnosis"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ForgeRunResult_runId_key" ON "ForgeRunResult"("runId");

-- CreateIndex
CREATE INDEX "ForgeLessonLearned_createdAt_idx" ON "ForgeLessonLearned"("createdAt");

-- CreateIndex
CREATE INDEX "ForgeLessonLearned_language_idx" ON "ForgeLessonLearned"("language");

-- CreateIndex
CREATE INDEX "PipelineRun_projectId_idx" ON "PipelineRun"("projectId");

-- CreateIndex
CREATE INDEX "PipelineRun_projectId_status_idx" ON "PipelineRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "PipelineStage_runId_idx" ON "PipelineStage"("runId");

-- CreateIndex
CREATE INDEX "PipelineStage_runId_status_idx" ON "PipelineStage"("runId", "status");

-- CreateIndex
CREATE INDEX "PipelineStage_nodeType_idx" ON "PipelineStage"("nodeType");

-- CreateIndex
CREATE INDEX "PipelineStage_skillName_idx" ON "PipelineStage"("skillName");

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_createdByStage_fkey" FOREIGN KEY ("createdByStage") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidenceScore" ADD CONSTRAINT "ConfidenceScore_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidenceScore" ADD CONSTRAINT "ConfidenceScore_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletenessCheck" ADD CONSTRAINT "CompletenessCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeedback" ADD CONSTRAINT "ProjectFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeedback" ADD CONSTRAINT "ProjectFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecCache" ADD CONSTRAINT "SpecCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeRun" ADD CONSTRAINT "ForgeRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeRunLog" ADD CONSTRAINT "ForgeRunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ForgeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeRunDiff" ADD CONSTRAINT "ForgeRunDiff_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ForgeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeRunDiagnosis" ADD CONSTRAINT "ForgeRunDiagnosis_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ForgeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeRunResult" ADD CONSTRAINT "ForgeRunResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ForgeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeLessonLearned" ADD CONSTRAINT "ForgeLessonLearned_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ForgeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

