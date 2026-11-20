import Anthropic from '@anthropic-ai/sdk';
import { SkillLoader } from '@/src/services/skill-loader';
import { handleAnthropicCreditError } from '@/src/lib/anthropic';
import { type TokenUsage } from '@/src/services/cost-tracker';
import { assertNotRefused, CLAUDE_MODELS, DOCUMENT_MAX_TOKENS, EFFORT, OutputTruncatedError } from '@/src/lib/models';
import {
  buildOutlineInstruction,
  buildPhasePrompt,
  ensurePhaseHeading,
  MAX_PHASES,
  mergePhaseSections,
  parseOutline,
  PHASE_CONCURRENCY,
  runWithConcurrency,
} from '@/src/services/phase-split';
import {
  buildPrdHeadPrompt,
  buildPrdOutlineInstruction,
  buildPrdPhasePrompt,
  buildPrdTailPrompt,
  ensurePrdPhaseHeading,
  mergePrdParts,
} from '@/src/services/prd-split';

import { isCodeBuildSkill, pipelineModeOverride } from '@/src/services/pipeline-mode';

export class StageExecutor {
  private client: Anthropic;

  /** Token usage from the last executeStage() call. Read after iteration completes. */
  public lastUsage: TokenUsage | null = null;

  constructor(client: Anthropic) {
    this.client = client;
  }

  /**
   * Entry point for a stage. Most skills run as one model call. The phase-builder
   * ("Split PRD into Phases") runs an outline call and then one call per phase, so a
   * long phase list cannot hit the single-response token cap.
   */
  async *executeStage(
    skillName: string,
    context: string,
    previousArtifacts: string[],
    signal?: AbortSignal
  ): AsyncGenerator<string, string, undefined> {
    this.lastUsage = null;
    if (skillName === 'prd-architect') {
      return yield* this.executePrdSplit(skillName, context, previousArtifacts, signal);
    }
    if (skillName !== 'phase-builder') {
      return yield* this.executeSingle(skillName, context, previousArtifacts, signal);
    }

    const total = { inputTokens: 0, outputTokens: 0 };
    const last: { model?: string; backend?: TokenUsage['backend'] } = {};
    const record = (u: TokenUsage) => {
      total.inputTokens += u.inputTokens;
      total.outputTokens += u.outputTokens;
      last.model = u.model;
      last.backend = u.backend;
    };

    // 1. Outline. Not yielded: only the phase sections become the artifact.
    const outlineGen = this.executeSingle(
      skillName, `${context}\n\n${buildOutlineInstruction()}`, previousArtifacts, signal, record,
    );
    let outlineText = '';
    for (;;) {
      const r = await outlineGen.next();
      if (r.done) { outlineText = r.value; break; }
    }

    const phases = parseOutline(outlineText);
    if (phases.length === 0) {
      console.warn('[StageExecutor] phase-builder: outline had no phase headings; using a single call');
      return yield* this.executeSingle(skillName, context, previousArtifacts, signal);
    }
    if (phases.length > MAX_PHASES) {
      throw new Error(`The phase outline has ${phases.length} phases; the limit is ${MAX_PHASES}. Narrow the PRD scope and rerun.`);
    }
    console.log(`[StageExecutor] phase-builder: outline has ${phases.length} phases, generating each one separately`);

    // 2. One call per phase, a few at a time. Any failure fails the stage.
    const sections = await runWithConcurrency(phases, PHASE_CONCURRENCY, async (phase) => {
      const gen = this.executeSingle(
        skillName, buildPhasePrompt(context, outlineText, phase), previousArtifacts, signal, record,
      );
      for (;;) {
        const r = await gen.next();
        if (r.done) return ensurePhaseHeading(r.value, phase);
      }
    });

    // 3. Join in order, in the same format the single call used.
    const merged = mergePhaseSections(sections);
    yield merged;

    this.lastUsage = {
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      model: last.model ?? CLAUDE_MODELS.main,
      backend: last.backend ?? 'anthropic',
    };
    return merged;
  }

  /**
   * Run one model call to completion and return its text. Usage is reported through
   * onUsage, which is safe to use with concurrent calls.
   */
  private async runCapture(
    skillName: string,
    prompt: string,
    previousArtifacts: string[],
    signal: AbortSignal | undefined,
    onUsage: (u: TokenUsage) => void,
  ): Promise<string> {
    const gen = this.executeSingle(skillName, prompt, previousArtifacts, signal, onUsage);
    for (;;) {
      const r = await gen.next();
      if (r.done) return r.value;
    }
  }

  /**
   * PRD ("Generate PRD") split: outline, then head (sections 1-5), one call per phase
   * in section 6, then tail (sections 7-9). Falls back to one call if no phases are found.
   */
  private async *executePrdSplit(
    skillName: string,
    context: string,
    previousArtifacts: string[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, string, undefined> {
    const total = { inputTokens: 0, outputTokens: 0 };
    const last: { model?: string; backend?: TokenUsage['backend'] } = {};
    const record = (u: TokenUsage) => {
      total.inputTokens += u.inputTokens;
      total.outputTokens += u.outputTokens;
      last.model = u.model;
      last.backend = u.backend;
    };

    const outlineText = await this.runCapture(
      skillName, `${context}\n\n${buildPrdOutlineInstruction(MAX_PHASES)}`, previousArtifacts, signal, record,
    );

    const phases = parseOutline(outlineText);
    if (phases.length === 0) {
      console.warn('[StageExecutor] prd-architect: outline had no phases; using a single call');
      return yield* this.executeSingle(skillName, context, previousArtifacts, signal);
    }
    if (phases.length > MAX_PHASES) {
      throw new Error(`The PRD outline has ${phases.length} phases; the limit is ${MAX_PHASES}. Narrow the scope and rerun.`);
    }
    console.log(`[StageExecutor] prd-architect: outline has ${phases.length} phases; writing head, ${phases.length} phases and tail separately`);

    const tasks: Array<() => Promise<string>> = [
      () => this.runCapture(skillName, buildPrdHeadPrompt(context, outlineText), previousArtifacts, signal, record),
      ...phases.map((phase) => async () => {
        const text = await this.runCapture(
          skillName, buildPrdPhasePrompt(context, outlineText, phase), previousArtifacts, signal, record,
        );
        return ensurePrdPhaseHeading(text, phase);
      }),
      () => this.runCapture(skillName, buildPrdTailPrompt(context, outlineText), previousArtifacts, signal, record),
    ];
    const parts = await runWithConcurrency(tasks, PHASE_CONCURRENCY, (task) => task());

    const head = parts[0];
    const tail = parts[parts.length - 1];
    const merged = mergePrdParts(head, parts.slice(1, -1), tail);
    yield merged;

    this.lastUsage = {
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      model: last.model ?? CLAUDE_MODELS.main,
      backend: last.backend ?? 'anthropic',
    };
    return merged;
  }

  private async *executeSingle(
    skillName: string,
    context: string,
    previousArtifacts: string[],
    signal?: AbortSignal,
    onUsage?: (u: TokenUsage) => void,
  ): AsyncGenerator<string, string, undefined> {
    this.lastUsage = null;
    const systemPrompt = (await SkillLoader.getSkillPromptAsync(skillName)) + pipelineModeOverride(skillName);

    // Build messages: include previous artifacts as context
    const messages: Anthropic.MessageParam[] = [];

    for (const artifact of previousArtifacts) {
      messages.push({ role: 'assistant', content: artifact });
      messages.push({ role: 'user', content: 'Proceed to the next stage.' });
    }

    // Current stage input
    messages.push({ role: 'user', content: context });

    console.log(`[StageExecutor] Executing skill: ${skillName}, context length: ${context.length}, prior artifacts: ${previousArtifacts.length}`);

    let fullText = '';
    let usedOllama = false;

    const streamParams = {
      model: CLAUDE_MODELS.main,
      max_tokens: DOCUMENT_MAX_TOKENS,
      output_config: { effort: isCodeBuildSkill(skillName) ? EFFORT.build : EFFORT.document },
      system: systemPrompt,
      messages,
    };

    let activeStream: { abort: () => void; [Symbol.asyncIterator]: () => AsyncIterator<unknown> };

    try {
      activeStream = this.client.messages.stream(streamParams);
    } catch (err: unknown) {
      const fallback = await this.handleFallback(err);
      if (fallback) {
        activeStream = fallback.messages.stream(streamParams);
        usedOllama = true;
      } else {
        throw err;
      }
    }

    if (signal) {
      signal.addEventListener('abort', () => {
        activeStream.abort();
      });
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;

    try {
      for await (const event of activeStream as AsyncIterable<{
        type: string;
        delta: { type: string; text: string };
        message?: { usage?: { input_tokens: number; output_tokens: number } };
        usage?: { input_tokens?: number; output_tokens?: number };
      }>) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const text = event.delta.text;
          fullText += text;
          yield text;
        }
        // Capture usage from message_start event
        if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens || 0;
        }
        // Capture usage from message_delta event (output tokens)
        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens || 0;
        }
        // Claude 5 models can decline a request mid-stream
        if (event.type === 'message_delta') {
          const delta = event.delta as { stop_reason?: string | null; stop_details?: unknown };
          assertNotRefused(delta);
          if (delta?.stop_reason) stopReason = delta.stop_reason;
        }
      }
    } catch (err: unknown) {
      // If we get a credit error mid-stream, retry with Ollama
      if (this.isCreditError(err) && fullText === '') {
        const fallback = await this.handleFallback(err);
        if (fallback) {
          this.client = fallback as unknown as Anthropic;
          usedOllama = true;
          const retryStream = fallback.messages.stream(streamParams);
          if (signal) {
            signal.addEventListener('abort', () => retryStream.abort());
          }
          for await (const event of retryStream as AsyncIterable<{ type: string; delta: { type: string; text: string } }>) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullText += event.delta.text;
              yield event.delta.text;
            }
          }
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Estimate tokens from text length if stream didn't provide usage (Groq/Ollama)
    if (inputTokens === 0 && outputTokens === 0 && fullText.length > 0) {
      // Rough estimate: ~4 chars per token
      const contextLength = context.length + previousArtifacts.join('').length + systemPrompt.length;
      inputTokens = Math.round(contextLength / 4);
      outputTokens = Math.round(fullText.length / 4);
    }

    // Detect which backend was actually used
    const isGroq = !!(process.env.GROQ_API_KEY && usedOllama);
    const isFallback = usedOllama || isGroq;
    let model: string;
    let backend: 'anthropic' | 'ollama' | 'groq';

    // Check if this client is a Groq wrapper by looking for the class name or env
    const clientName = (this.client as unknown as { constructor: { name: string } })?.constructor?.name || '';
    if (clientName === 'GroqAnthropicCompat' || (process.env.GROQ_API_KEY && isFallback)) {
      model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
      backend = 'groq';
    } else if (usedOllama) {
      model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
      backend = 'ollama';
    } else {
      model = CLAUDE_MODELS.main;
      backend = 'anthropic';
    }

    this.lastUsage = {
      inputTokens,
      outputTokens,
      model,
      backend,
    };
    onUsage?.(this.lastUsage);

    // Ran out of output tokens: the document is cut off. Fail the stage (cost is already
    // recorded above) rather than approving a half-finished PRD and handing it downstream.
    if (stopReason === 'max_tokens') {
      throw new OutputTruncatedError(outputTokens, streamParams.max_tokens);
    }

    return fullText;
  }

  private isCreditError(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    const msg = (err as { message?: string })?.message || '';
    return status === 400 && msg.includes('credit balance');
  }

  private async handleFallback(err: unknown): Promise<Anthropic | null> {
    if (this.isCreditError(err)) {
      console.log('[StageExecutor] Anthropic out of credits, switching to Ollama');
      const fallback = await handleAnthropicCreditError();
      return fallback as unknown as Anthropic | null;
    }
    return null;
  }
}
