import { randomUUID } from "crypto";
import type {
  AssembledLesson,
  LessonOptions,
  LessonPlan,
  PipelineLog,
  PipelineStep,
  ReviewFeedbackItem,
  ScriptedLesson,
  ValidatedSection,
  AudioClip,
} from "./types";
import { Planner } from "./planner";
import { Scripter } from "./scripter";
import { Validator } from "./validator";
import { TTSService } from "./tts";
import { Assembler } from "./assembler";
import { PlanReviewer } from "./plan-reviewer";
import { ScriptReviewer } from "./script-reviewer";
import { FinalReviewer } from "./final-reviewer";

const MAX_PLAN_ROUNDS = 3;
const MAX_SCRIPT_ROUNDS = 3;
const MAX_FINAL_ROUNDS = 3;

export class LeadAgent {
  private planner = new Planner();
  private scripter = new Scripter();
  private validator = new Validator();
  private tts = new TTSService();
  private assembler = new Assembler();
  private planReviewer = new PlanReviewer();
  private scriptReviewer = new ScriptReviewer();
  private finalReviewer = new FinalReviewer();

  private _log!: PipelineLog;

  get log(): PipelineLog {
    return this._log;
  }

  async generateLesson(
    topic: string,
    options: LessonOptions
  ): Promise<{ lesson: AssembledLesson; clips: AudioClip[] }> {
    this._log = {
      runId: randomUUID(),
      topic,
      options,
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [],
      totalLLMCalls: 0,
      totalLLMTokens: { input: 0, output: 0 },
    };

    try {
      // Phase 1: Plan with review loop
      const plan = await this.phasePlan(topic, options);

      // Phase 2: Script with review loop
      const script = await this.phaseScript(plan);

      // Phase 3: Validate
      const validatedSections = await this.phaseValidate(
        script,
        options.language
      );

      // Phase 4: TTS
      const clips = await this.phaseTTS(script);

      // Phase 5: Assemble
      const lesson = await this.phaseAssemble(
        plan,
        options,
        validatedSections,
        clips
      );

      // Phase 6: Final review loop
      const finalLesson = await this.phaseFinalReview(
        lesson,
        plan,
        options,
        script,
        validatedSections,
        clips
      );

      this._log.status = "completed";
      this._log.completedAt = new Date().toISOString();
      return { lesson: finalLesson, clips };
    } catch (err) {
      this._log.status = "failed";
      this._log.completedAt = new Date().toISOString();
      throw err;
    }
  }

  // ── Phase 1: Plan ──────────────────────────────────────────────────

  private async phasePlan(
    topic: string,
    options: LessonOptions
  ): Promise<LessonPlan> {
    console.log("[Planner] Generating lesson plan...");
    const step = this.startStep("Planner", "generate", 1);
    let plan = await this.planner.plan(topic, options);
    this.completeStep(step);

    for (let round = 1; round <= MAX_PLAN_ROUNDS; round++) {
      console.log(`[PlanReviewer] Round ${round}: Reviewing...`);
      const reviewStep = this.startStep("PlanReviewer", "review", round);
      const review = await this.planReviewer.review(plan, topic, options);
      reviewStep.approved = review.approved;
      this.completeStep(reviewStep);

      if (review.approved) {
        console.log(`[PlanReviewer] Round ${round}: Approved`);
        return plan;
      }

      console.log(
        `[PlanReviewer] Round ${round}: Rejected (${review.feedback.filter((f) => f.severity === "blocker").length} blockers)`
      );

      if (round === MAX_PLAN_ROUNDS) {
        throw new Error(
          `Plan rejected after ${MAX_PLAN_ROUNDS} rounds. Last feedback: ${JSON.stringify(review.feedback)}`
        );
      }

      console.log(`[Planner] Revising plan (round ${round + 1})...`);
      const reviseStep = this.startStep("Planner", "revise", round + 1);
      plan = await this.planner.revise(plan, review.feedback);
      this.completeStep(reviseStep);
    }

    return plan;
  }

  // ── Phase 2: Script ────────────────────────────────────────────────

  private async phaseScript(plan: LessonPlan): Promise<ScriptedLesson> {
    console.log("[Scripter] Generating script...");
    const step = this.startStep("Scripter", "generate", 1);
    let script = await this.scripter.script(plan);
    this.completeStep(step);

    for (let round = 1; round <= MAX_SCRIPT_ROUNDS; round++) {
      console.log(`[ScriptReviewer] Round ${round}: Reviewing...`);
      const reviewStep = this.startStep("ScriptReviewer", "review", round);
      const review = await this.scriptReviewer.review(script, plan);
      reviewStep.approved = review.approved;
      this.completeStep(reviewStep);

      if (review.approved) {
        console.log(`[ScriptReviewer] Round ${round}: Approved`);
        return script;
      }

      console.log(
        `[ScriptReviewer] Round ${round}: Rejected (${review.feedback.filter((f) => f.severity === "blocker").length} blockers)`
      );

      if (round === MAX_SCRIPT_ROUNDS) {
        throw new Error(
          `Script rejected after ${MAX_SCRIPT_ROUNDS} rounds. Last feedback: ${JSON.stringify(review.feedback)}`
        );
      }

      console.log(`[Scripter] Revising script (round ${round + 1})...`);
      const reviseStep = this.startStep("Scripter", "revise", round + 1);
      script = await this.scripter.revise(script, plan, review.feedback);
      this.completeStep(reviseStep);
    }

    return script;
  }

  // ── Phase 3: Validate ──────────────────────────────────────────────

  private async phaseValidate(
    script: ScriptedLesson,
    language: string
  ): Promise<ValidatedSection[]> {
    console.log("[Validator] Validating all sections in sandbox...");
    const step = this.startStep("Validator", "validateAll", 1);
    const validated = await this.validator.validateAll(
      script.sections,
      language
    );
    this.completeStep(step);
    console.log(`[Validator] All ${validated.length} sections validated`);
    return validated;
  }

  // ── Phase 4: TTS ──────────────────────────────────────────────────

  private async phaseTTS(script: ScriptedLesson): Promise<AudioClip[]> {
    console.log("[TTS] Generating audio for all sections...");
    const step = this.startStep("TTS", "generateAll", 1);
    const clips = await this.tts.generateAll(script.sections);
    this.completeStep(step);
    const totalDuration = clips.reduce((s, c) => s + c.durationSeconds, 0);
    console.log(
      `[TTS] Generated ${clips.length} clips, total ${totalDuration.toFixed(1)}s`
    );
    return clips;
  }

  // ── Phase 5: Assemble ─────────────────────────────────────────────

  private async phaseAssemble(
    plan: LessonPlan,
    options: LessonOptions,
    validatedSections: ValidatedSection[],
    clips: AudioClip[]
  ): Promise<AssembledLesson> {
    console.log("[Assembler] Assembling lesson...");
    const step = this.startStep("Assembler", "assemble", 1);
    const lesson = this.assembler.assemble(
      plan,
      options,
      validatedSections,
      clips
    );
    this.completeStep(step);
    console.log(
      `[Assembler] Assembled: ${lesson.sections.length} sections, ${lesson.totalDuration.toFixed(1)}s total`
    );
    return lesson;
  }

  // ── Phase 6: Final Review ─────────────────────────────────────────

  private async phaseFinalReview(
    lesson: AssembledLesson,
    plan: LessonPlan,
    options: LessonOptions,
    script: ScriptedLesson,
    validatedSections: ValidatedSection[],
    clips: AudioClip[]
  ): Promise<AssembledLesson> {
    let current = lesson;

    for (let round = 1; round <= MAX_FINAL_ROUNDS; round++) {
      console.log(`[FinalReviewer] Round ${round}: Reviewing...`);
      const reviewStep = this.startStep("FinalReviewer", "review", round);
      const review = await this.finalReviewer.review(current);
      reviewStep.approved = review.approved;
      this.completeStep(reviewStep);

      if (review.approved) {
        console.log(
          `[FinalReviewer] Round ${round}: Approved (quality: ${review.quality_score}/10)`
        );
        return current;
      }

      console.log(
        `[FinalReviewer] Round ${round}: Rejected (quality: ${review.quality_score}/10, ${review.feedback.filter((f) => f.severity === "blocker").length} blockers)`
      );

      if (round === MAX_FINAL_ROUNDS) {
        throw new Error(
          `Final review rejected after ${MAX_FINAL_ROUNDS} rounds. Last feedback: ${JSON.stringify(review.feedback)}`
        );
      }

      // Route feedback to the appropriate stage
      current = await this.routeFinalFeedback(
        review.feedback,
        plan,
        options,
        script,
        validatedSections,
        clips
      );
    }

    return current;
  }

  private async routeFinalFeedback(
    feedback: ReviewFeedbackItem[],
    plan: LessonPlan,
    options: LessonOptions,
    script: ScriptedLesson,
    validatedSections: ValidatedSection[],
    clips: AudioClip[]
  ): Promise<AssembledLesson> {
    const planFeedback = feedback.filter((f) => f.route_to === "plan");
    const scriptFeedback = feedback.filter((f) => f.route_to === "script");
    const assemblyFeedback = feedback.filter(
      (f) => f.route_to === "assembly"
    );

    let currentPlan = plan;
    let currentScript = script;
    let currentValidated = validatedSections;
    let currentClips = clips;

    // If plan-level issues, re-run from plan revision onward
    if (planFeedback.length > 0) {
      console.log(
        `[LeadAgent] Routing ${planFeedback.length} issues back to Planner...`
      );
      const reviseStep = this.startStep("Planner", "revise (final feedback)", 1);
      currentPlan = await this.planner.revise(currentPlan, planFeedback);
      this.completeStep(reviseStep);

      // Re-script with Script Review loop
      console.log("[Scripter] Re-generating script after plan revision...");
      currentScript = await this.phaseScript(currentPlan);

      // Re-validate
      currentValidated = await this.phaseValidate(
        currentScript,
        options.language
      );

      // Re-TTS
      currentClips = await this.phaseTTS(currentScript);
    } else if (scriptFeedback.length > 0) {
      console.log(
        `[LeadAgent] Routing ${scriptFeedback.length} issues back to Scripter...`
      );
      const reviseStep = this.startStep("Scripter", "revise (final feedback)", 1);
      currentScript = await this.scripter.revise(
        currentScript,
        currentPlan,
        scriptFeedback
      );
      this.completeStep(reviseStep);

      // Re-run Script Review on the revised script (this was previously skipped,
      // letting the same class of issues survive through re-scripting)
      console.log("[ScriptReviewer] Re-reviewing revised script...");
      const reReviewStep = this.startStep("ScriptReviewer", "review (after final feedback)", 1);
      const reReview = await this.scriptReviewer.review(currentScript, currentPlan);
      reReviewStep.approved = reReview.approved;
      this.completeStep(reReviewStep);

      if (!reReview.approved) {
        console.log(
          `[ScriptReviewer] Rejected re-revised script (${reReview.feedback.filter((f) => f.severity === "blocker").length} blockers), revising again...`
        );
        const reReviseStep = this.startStep("Scripter", "revise (script re-review)", 1);
        currentScript = await this.scripter.revise(
          currentScript,
          currentPlan,
          reReview.feedback
        );
        this.completeStep(reReviseStep);
      }

      // Re-validate
      currentValidated = await this.phaseValidate(
        currentScript,
        options.language
      );

      // Re-TTS
      currentClips = await this.phaseTTS(currentScript);
    }

    // Always re-assemble (assembly feedback or cascading from above)
    if (planFeedback.length > 0 || scriptFeedback.length > 0 || assemblyFeedback.length > 0) {
      console.log("[Assembler] Re-assembling after feedback routing...");
    }

    return this.assembler.assemble(
      currentPlan,
      options,
      currentValidated,
      currentClips
    );
  }

  // ── Logging helpers ───────────────────────────────────────────────

  private startStep(
    agent: string,
    action: string,
    round: number
  ): PipelineStep {
    const step: PipelineStep = {
      agent,
      action,
      round,
      startedAt: new Date().toISOString(),
    };
    this._log.steps.push(step);
    this._log.totalLLMCalls++;
    return step;
  }

  private completeStep(step: PipelineStep): void {
    step.completedAt = new Date().toISOString();
  }
}
