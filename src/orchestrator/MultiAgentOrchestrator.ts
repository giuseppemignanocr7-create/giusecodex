import * as vscode from 'vscode';
import {
    TaskType,
    StepStatus,
    PipelineStep,
    PipelineCallbacks,
    PipelineProgress,
    StepProgress,
    OrchestratorConfig,
    AgentModelConfig,
    PlanSection,
    ReviewResult,
    AgentResult,
    buildRoutingTable,
    RoutingEntry
} from './types';
import { TriageEngine } from './TriageEngine';
import { AgentCallers } from './AgentCallers';
import { PlanParser } from './PlanParser';
import { ResultMerger } from './ResultMerger';
import { CostTracker } from './CostTracker';
import { AIProviderManager } from '../providers/AIProviderManager';
import { OpenAIProvider } from '../providers/OpenAIProvider';

export interface OrchestratorInput {
    userPrompt: string;
    context: string;
    signal?: AbortSignal;
    callbacks: PipelineCallbacks;
}

export interface OrchestratorOutput {
    text: string;
    taskType: TaskType;
    results: AgentResult[];
    totalCostUsd: number;
    totalDurationMs: number;
    reviewResult?: ReviewResult;
}

export class MultiAgentOrchestrator {
    private readonly triageEngine: TriageEngine;
    private readonly planParser: PlanParser;
    private readonly resultMerger: ResultMerger;
    private readonly costTracker: CostTracker;
    private readonly routingTable: RoutingEntry[];
    private agentCallers!: AgentCallers;

    constructor(
        private readonly anthropicProvider: AIProviderManager,
        private readonly openaiProvider: OpenAIProvider
    ) {
        this.costTracker = new CostTracker();
        this.planParser = new PlanParser();
        this.resultMerger = new ResultMerger();
        this.triageEngine = new TriageEngine(anthropicProvider);
        this.routingTable = buildRoutingTable();
    }

    private buildAgentCallers(models: AgentModelConfig, config: OrchestratorConfig): AgentCallers {
        return new AgentCallers(
            this.anthropicProvider,
            this.openaiProvider,
            this.costTracker,
            models,
            config.codexReasoningEffort
        );
    }

    public async process(input: OrchestratorInput): Promise<OrchestratorOutput> {
        const startMs = Date.now();
        const config = this.readConfig();
        const models = this.readModels();
        const results: AgentResult[] = [];

        const triageStepProgress: StepProgress = {
            stepId: 'triage',
            label: 'Classifying task',
            agent: 'haiku',
            status: 'running'
        };

        input.callbacks.onStepStart(triageStepProgress);

        const triage = await this.triageEngine.classify(
            input.userPrompt,
            input.context,
            models.haiku,
            input.signal
        );

        this.costTracker.record('haiku', triage.inputTokens, triage.outputTokens, triage.costUsd);

        triageStepProgress.status = 'done';
        triageStepProgress.costUsd = triage.costUsd;
        input.callbacks.onStepComplete(triageStepProgress);

        results.push({
            agent: 'haiku',
            stepId: 'triage',
            text: JSON.stringify(triage.result),
            model: models.haiku,
            inputTokens: triage.inputTokens,
            outputTokens: triage.outputTokens,
            costUsd: triage.costUsd,
            durationMs: 0
        });

        const taskType = triage.result.taskType;
        const routing = this.routingTable.find(r => r.taskType === taskType)
            ?? this.routingTable.find(r => r.taskType === 'unknown')!;

        const pipeline: PipelineStep[] = routing.pipeline
            .filter(step => step.id !== 'triage')
            .map(step => ({ ...step, status: 'waiting' as StepStatus }));

        this.emitProgress(input.callbacks, taskType, pipeline, startMs);

        this.agentCallers = this.buildAgentCallers(models, config);

        let planSection: PlanSection = {};
        let designOutput = '';
        let codeOutput = '';
        let reviewResult: ReviewResult | undefined;

        for (let i = 0; i < pipeline.length; i++) {
            const step = pipeline[i];
            this.throwIfAborted(input.signal);

            if (step.action === 'review' && !config.autoReview) {
                step.status = 'skipped';
                this.emitProgress(input.callbacks, taskType, pipeline, startMs);
                continue;
            }

            const canParallel = config.parallelExecution && this.findParallelGroup(pipeline, i);
            if (canParallel) {
                const parallelResults = await this.executeParallelGroup(
                    canParallel.steps,
                    input,
                    planSection,
                    designOutput,
                    pipeline,
                    taskType,
                    startMs
                );

                for (const pr of parallelResults) {
                    results.push(pr.result);
                    if (pr.step.action === 'design') {
                        designOutput = pr.result.text;
                    }
                    if (pr.step.action === 'implement') {
                        codeOutput = pr.result.text;
                    }
                }

                i = canParallel.endIndex;
                continue;
            }

            const result = await this.executeStep(
                step,
                input,
                planSection,
                designOutput,
                codeOutput,
                pipeline,
                taskType,
                startMs
            );

            results.push(result);

            if (step.action === 'plan') {
                planSection = this.planParser.parse(result.text);
            }
            if (step.action === 'design' || step.action === 'explain' || step.action === 'document') {
                designOutput = result.text;
            }
            if (step.action === 'implement') {
                codeOutput = result.text;
            }
            if (step.action === 'answer' || step.action === 'generate') {
                codeOutput = result.text;
            }
            if (step.action === 'review') {
                reviewResult = this.parseReviewResult(result.text);

                if (config.autoFix && reviewResult && !reviewResult.approved) {
                    const fixResult = await this.autoFix(
                        input,
                        planSection,
                        codeOutput,
                        result.text,
                        config,
                        pipeline,
                        taskType,
                        startMs
                    );

                    if (fixResult) {
                        results.push(fixResult);
                        codeOutput = fixResult.text;
                    }
                }
            }
        }

        const merged = this.resultMerger.merge(designOutput, codeOutput);
        const totalDurationMs = Date.now() - startMs;

        this.anthropicProvider.accumulateUsage(
            this.costTracker.getStats().totalInputTokens,
            this.costTracker.getStats().totalOutputTokens,
            this.costTracker.getTotalCost()
        );

        return {
            text: merged.combined || codeOutput || designOutput,
            taskType,
            results,
            totalCostUsd: this.costTracker.getTotalCost(),
            totalDurationMs,
            reviewResult
        };
    }

    private async executeStep(
        step: PipelineStep,
        input: OrchestratorInput,
        plan: PlanSection,
        designOutput: string,
        codeOutput: string,
        allSteps: PipelineStep[],
        taskType: TaskType,
        pipelineStartMs: number
    ): Promise<AgentResult> {
        step.status = 'running';
        const stepProgress: StepProgress = {
            stepId: step.id,
            label: step.label,
            agent: step.agent,
            status: 'running'
        };

        input.callbacks.onStepStart(stepProgress);
        this.emitProgress(input.callbacks, taskType, allSteps, pipelineStartMs);

        try {
            const prompt = this.buildPromptForStep(step, input, plan, designOutput, codeOutput);

            const result = await this.agentCallers.call({
                prompt,
                agent: step.agent,
                action: step.action,
                signal: input.signal,
                onToken: (token) => input.callbacks.onToken(step.id, token)
            });

            step.status = 'done';
            stepProgress.status = 'done';
            stepProgress.costUsd = result.costUsd;
            stepProgress.durationMs = result.durationMs;
            input.callbacks.onStepComplete(stepProgress);
            this.emitProgress(input.callbacks, taskType, allSteps, pipelineStartMs);

            return {
                agent: step.agent,
                stepId: step.id,
                text: result.text,
                model: result.model,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                costUsd: result.costUsd,
                durationMs: result.durationMs
            };
        } catch (error: unknown) {
            step.status = 'failed';
            stepProgress.status = 'failed';

            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            input.callbacks.onStepFailed(stepProgress, errorMessage);
            this.emitProgress(input.callbacks, taskType, allSteps, pipelineStartMs);

            throw error;
        }
    }

    private async executeParallelGroup(
        steps: PipelineStep[],
        input: OrchestratorInput,
        plan: PlanSection,
        designOutput: string,
        allSteps: PipelineStep[],
        taskType: TaskType,
        pipelineStartMs: number
    ): Promise<Array<{ step: PipelineStep; result: AgentResult }>> {
        const promises = steps.map(step =>
            this.executeStep(step, input, plan, designOutput, '', allSteps, taskType, pipelineStartMs)
                .then(result => ({ step, result }))
        );

        const settled = await Promise.allSettled(promises);
        const results: Array<{ step: PipelineStep; result: AgentResult }> = [];

        for (const outcome of settled) {
            if (outcome.status === 'fulfilled') {
                results.push(outcome.value);
            } else {
                throw outcome.reason;
            }
        }

        return results;
    }

    private findParallelGroup(steps: PipelineStep[], currentIndex: number): { steps: PipelineStep[]; endIndex: number } | null {
        const current = steps[currentIndex];
        if (!current.parallel) {
            return null;
        }

        const group: PipelineStep[] = [current];
        let endIndex = currentIndex;

        for (let j = currentIndex + 1; j < steps.length; j++) {
            if (steps[j].parallel && this.sameDependencies(current, steps[j])) {
                group.push(steps[j]);
                endIndex = j;
            } else {
                break;
            }
        }

        if (group.length < 2) {
            return null;
        }

        return { steps: group, endIndex };
    }

    private sameDependencies(a: PipelineStep, b: PipelineStep): boolean {
        const depsA = (a.dependsOn ?? []).sort().join(',');
        const depsB = (b.dependsOn ?? []).sort().join(',');
        return depsA === depsB;
    }

    private buildPromptForStep(
        step: PipelineStep,
        input: OrchestratorInput,
        plan: PlanSection,
        designOutput: string,
        codeOutput: string
    ): string {
        switch (step.action) {
            case 'plan':
                return this.buildPlanPrompt(input.userPrompt, input.context);
            case 'design':
                return this.planParser.buildDesignPrompt(plan, input.userPrompt, input.context);
            case 'implement':
                return this.planParser.buildCodePrompt(plan, input.userPrompt, input.context, designOutput);
            case 'review':
                return this.planParser.buildReviewPrompt(plan, designOutput, codeOutput);
            case 'explain':
            case 'answer':
            case 'document':
            case 'generate':
                return this.buildDirectPrompt(step.action, input.userPrompt, input.context);
            default:
                return input.userPrompt;
        }
    }

    private buildPlanPrompt(userPrompt: string, context: string): string {
        const parts = ['## User Request', userPrompt, ''];
        if (context) {
            parts.push('## Context', context, '');
        }
        parts.push('Create a structured plan following your XML format.');
        return parts.join('\n');
    }

    private buildDirectPrompt(action: string, userPrompt: string, context: string): string {
        const parts = [`## Request (${action})`, userPrompt, ''];
        if (context) {
            parts.push('## Context', context, '');
        }
        return parts.join('\n');
    }

    private async autoFix(
        input: OrchestratorInput,
        plan: PlanSection,
        codeOutput: string,
        reviewText: string,
        config: OrchestratorConfig,
        allSteps: PipelineStep[],
        taskType: TaskType,
        pipelineStartMs: number
    ): Promise<AgentResult | null> {
        for (let round = 0; round < config.maxFixRounds; round++) {
            this.throwIfAborted(input.signal);

            const fixStep: PipelineStep = {
                id: `fix-${round}`,
                agent: 'codex',
                action: 'implement',
                label: `Auto-fix round ${round + 1}`,
                status: 'waiting'
            };

            const prompt = this.planParser.buildFixPrompt(codeOutput, reviewText, plan);

            fixStep.status = 'running';
            const stepProgress: StepProgress = {
                stepId: fixStep.id,
                label: fixStep.label,
                agent: fixStep.agent,
                status: 'running'
            };

            input.callbacks.onStepStart(stepProgress);

            try {
                const result = await this.agentCallers.call({
                    prompt,
                    agent: 'codex',
                    action: 'implement',
                    signal: input.signal,
                    onToken: (token) => input.callbacks.onToken(fixStep.id, token)
                });

                fixStep.status = 'done';
                stepProgress.status = 'done';
                stepProgress.costUsd = result.costUsd;
                stepProgress.durationMs = result.durationMs;
                input.callbacks.onStepComplete(stepProgress);

                return {
                    agent: 'codex',
                    stepId: fixStep.id,
                    text: result.text,
                    model: result.model,
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    costUsd: result.costUsd,
                    durationMs: result.durationMs
                };
            } catch (error: unknown) {
                fixStep.status = 'failed';
                stepProgress.status = 'failed';
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                input.callbacks.onStepFailed(stepProgress, errorMessage);

                if (error instanceof Error && error.name === 'AbortError') {
                    throw error;
                }

                return null;
            }
        }

        return null;
    }

    private parseReviewResult(rawText: string): ReviewResult {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { approved: true, issues: [], summary: 'Could not parse review output; assuming approved.' };
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

            const approved = Boolean(parsed.approved ?? true);
            const issues = Array.isArray(parsed.issues)
                ? parsed.issues.map((issue: Record<string, unknown>) => ({
                    severity: (String(issue.severity ?? 'low')) as 'critical' | 'high' | 'medium' | 'low',
                    description: String(issue.description ?? ''),
                    file: issue.file ? String(issue.file) : undefined,
                    line: typeof issue.line === 'number' ? issue.line : undefined
                }))
                : [];
            const summary = String(parsed.summary ?? '');

            return { approved, issues, summary };
        } catch {
            return { approved: true, issues: [], summary: 'JSON parse error in review; assuming approved.' };
        }
    }

    private emitProgress(
        callbacks: PipelineCallbacks,
        taskType: TaskType,
        steps: PipelineStep[],
        pipelineStartMs: number
    ): void {
        const progress: PipelineProgress = {
            taskType,
            steps: steps.map(s => ({
                stepId: s.id,
                label: s.label,
                agent: s.agent,
                status: s.status
            })),
            totalCostUsd: this.costTracker.getTotalCost(),
            elapsedMs: Date.now() - pipelineStartMs
        };

        callbacks.onProgress(progress);
    }

    public getCostTracker(): CostTracker {
        return this.costTracker;
    }

    public readConfig(): OrchestratorConfig {
        const cfg = vscode.workspace.getConfiguration('giuseCoder.orchestrator');
        return {
            enabled: cfg.get<boolean>('enabled', true),
            autoReview: cfg.get<boolean>('autoReview', true),
            autoFix: cfg.get<boolean>('autoFix', true),
            parallelExecution: cfg.get<boolean>('parallelExecution', true),
            costWarningThreshold: cfg.get<number>('costWarningThreshold', 0.50),
            defaultMode: cfg.get<'orchestrated' | 'single'>('defaultMode', 'orchestrated'),
            codexReasoningEffort: cfg.get<'low' | 'medium' | 'high'>('codexReasoningEffort', 'high'),
            maxFixRounds: cfg.get<number>('maxFixRounds', 1)
        };
    }

    public readModels(): AgentModelConfig {
        const cfg = vscode.workspace.getConfiguration('giuseCoder.orchestrator.models');
        return {
            haiku: cfg.get<string>('haiku', 'claude-haiku-4-5-20251001'),
            sonnet: cfg.get<string>('sonnet', 'claude-sonnet-4-20250514'),
            opus: cfg.get<string>('opus', 'claude-opus-4-6'),
            codex: cfg.get<string>('codex', 'gpt-5.3-codex')
        };
    }

    private throwIfAborted(signal?: AbortSignal): void {
        if (signal?.aborted) {
            const abortError = new Error('Request aborted by user.');
            abortError.name = 'AbortError';
            throw abortError;
        }
    }
}
