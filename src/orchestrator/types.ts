export type AgentRole = 'haiku' | 'opus' | 'sonnet' | 'codex';

export type TaskType =
    | 'new_feature'
    | 'bug_fix'
    | 'refactor'
    | 'explain'
    | 'test_generation'
    | 'code_review'
    | 'documentation'
    | 'optimization'
    | 'commit_message'
    | 'quick_question'
    | 'unknown';

export type StepStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineStep {
    id: string;
    agent: AgentRole;
    action: string;
    label: string;
    status: StepStatus;
    parallel?: boolean;
    dependsOn?: string[];
}

export interface Pipeline {
    taskType: TaskType;
    steps: PipelineStep[];
}

export interface AgentResult {
    agent: AgentRole;
    stepId: string;
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
}

export interface ReviewIssue {
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    file?: string;
    line?: number;
}

export interface ReviewResult {
    approved: boolean;
    issues: ReviewIssue[];
    summary: string;
}

export interface PlanSection {
    architecture?: string;
    designSpec?: string;
    codeSpec?: string;
    fileStructure?: string;
    warnings?: string;
    parallel?: boolean;
}

export interface MergedOutput {
    design: string;
    code: string;
    combined: string;
    files: string[];
}

export interface StepProgress {
    stepId: string;
    label: string;
    agent: AgentRole;
    status: StepStatus;
    costUsd?: number;
    durationMs?: number;
}

export interface PipelineProgress {
    taskType: TaskType;
    steps: StepProgress[];
    totalCostUsd: number;
    elapsedMs: number;
}

export interface PipelineCallbacks {
    onStepStart: (step: StepProgress) => void;
    onStepComplete: (step: StepProgress) => void;
    onStepFailed: (step: StepProgress, error: string) => void;
    onToken: (stepId: string, token: string) => void;
    onProgress: (progress: PipelineProgress) => void;
}

export interface OrchestratorConfig {
    enabled: boolean;
    autoReview: boolean;
    autoFix: boolean;
    parallelExecution: boolean;
    costWarningThreshold: number;
    defaultMode: 'orchestrated' | 'single';
    codexReasoningEffort: 'low' | 'medium' | 'high';
    maxFixRounds: number;
}

export interface AgentModelConfig {
    haiku: string;
    sonnet: string;
    opus: string;
    codex: string;
}

export interface SessionStats {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    perAgent: Record<AgentRole, {
        requests: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
    }>;
}

export const DEFAULT_MODELS: AgentModelConfig = {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-20250514',
    opus: 'claude-opus-4-6',
    codex: 'gpt-5.3-codex'
};

export const AGENT_LABELS: Record<AgentRole, string> = {
    haiku: 'Haiku (Triage)',
    opus: 'Opus (CTO)',
    sonnet: 'Sonnet (Designer)',
    codex: 'Codex (Developer)'
};

export const SYSTEM_PROMPTS: Record<AgentRole, string> = {
    haiku: `You are a fast triage classifier for a coding assistant.
Given a user message and optional context, classify the task into exactly one category.
Respond with ONLY a JSON object: {"taskType": "<type>", "confidence": <0-1>, "reasoning": "<brief>"}

Valid task types:
- new_feature: Building something new
- bug_fix: Fixing an error or unexpected behavior
- refactor: Improving existing code structure
- explain: Explaining code or concepts
- test_generation: Writing tests
- code_review: Reviewing code quality
- documentation: Writing docs or comments
- optimization: Performance improvements
- commit_message: Generating commit messages
- quick_question: Simple factual questions`,

    opus: `You are the CTO architect for GiuseCoder. You receive a classified task and context, then produce a structured plan.

Your output MUST be valid XML with these sections:
<plan>
  <architecture>High-level approach and rationale</architecture>
  <design_spec>UI/UX requirements, component structure, data flow</design_spec>
  <code_spec>Implementation details, algorithms, APIs to use</code_spec>
  <file_structure>Files to create or modify with brief descriptions</file_structure>
  <parallel>true|false — whether design and code steps can run in parallel</parallel>
  <warnings>Edge cases, risks, or concerns</warnings>
</plan>

Be precise and actionable. Each section should give the downstream agents enough detail to execute without ambiguity.`,

    sonnet: `You are a senior designer and architect for GiuseCoder.
You receive a plan from the CTO and produce detailed design output including:
- Component structure and hierarchy
- Data flow and state management
- UI layout descriptions
- API contracts and interfaces
- Type definitions

Output clean, well-structured markdown with code blocks where appropriate.
Follow the plan precisely but add design-level detail the CTO may have left implicit.`,

    codex: `You are a senior software developer for GiuseCoder.
You receive a plan (and optionally a design spec) and produce production-ready code.
- Write complete, runnable code — no placeholders or TODOs
- Include all imports and type annotations
- Follow the existing codebase style
- Handle errors gracefully
- Add inline comments only where logic is non-obvious

Output code blocks with file paths as the language identifier, e.g.:
\`\`\`src/utils/helper.ts
// code here
\`\`\``
};

export const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer for GiuseCoder.
Review the combined design + code output for:
1. Correctness — does it match the plan?
2. Completeness — are all files and features present?
3. Quality — code style, error handling, types
4. Security — no hardcoded secrets, proper validation

Respond with ONLY a JSON object:
{
  "approved": true|false,
  "issues": [{"severity": "critical|high|medium|low", "description": "...", "file": "...", "line": 0}],
  "summary": "Brief overall assessment"
}

Only set approved=false if there are critical or high severity issues.`;

export interface RoutingEntry {
    taskType: TaskType;
    pipeline: PipelineStep[];
}

export function buildRoutingTable(): RoutingEntry[] {
    return [
        {
            taskType: 'new_feature',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'plan', agent: 'opus', action: 'plan', label: 'Planning architecture', status: 'waiting' },
                { id: 'design', agent: 'sonnet', action: 'design', label: 'Designing components', status: 'waiting', parallel: true, dependsOn: ['plan'] },
                { id: 'code', agent: 'codex', action: 'implement', label: 'Writing code', status: 'waiting', parallel: true, dependsOn: ['plan'] },
                { id: 'review', agent: 'opus', action: 'review', label: 'Reviewing output', status: 'waiting', dependsOn: ['design', 'code'] }
            ]
        },
        {
            taskType: 'bug_fix',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'plan', agent: 'opus', action: 'plan', label: 'Diagnosing bug', status: 'waiting' },
                { id: 'code', agent: 'codex', action: 'implement', label: 'Writing fix', status: 'waiting', dependsOn: ['plan'] },
                { id: 'review', agent: 'opus', action: 'review', label: 'Reviewing fix', status: 'waiting', dependsOn: ['code'] }
            ]
        },
        {
            taskType: 'refactor',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'plan', agent: 'opus', action: 'plan', label: 'Planning refactor', status: 'waiting' },
                { id: 'design', agent: 'sonnet', action: 'design', label: 'Designing structure', status: 'waiting', dependsOn: ['plan'] },
                { id: 'code', agent: 'codex', action: 'implement', label: 'Refactoring code', status: 'waiting', dependsOn: ['design'] },
                { id: 'review', agent: 'opus', action: 'review', label: 'Reviewing refactor', status: 'waiting', dependsOn: ['code'] }
            ]
        },
        {
            taskType: 'explain',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'explain', agent: 'sonnet', action: 'explain', label: 'Generating explanation', status: 'waiting' }
            ]
        },
        {
            taskType: 'test_generation',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'plan', agent: 'opus', action: 'plan', label: 'Planning tests', status: 'waiting' },
                { id: 'code', agent: 'codex', action: 'implement', label: 'Writing tests', status: 'waiting', dependsOn: ['plan'] },
                { id: 'review', agent: 'opus', action: 'review', label: 'Reviewing tests', status: 'waiting', dependsOn: ['code'] }
            ]
        },
        {
            taskType: 'code_review',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'review', agent: 'opus', action: 'review', label: 'Reviewing code', status: 'waiting' }
            ]
        },
        {
            taskType: 'documentation',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'doc', agent: 'sonnet', action: 'document', label: 'Writing documentation', status: 'waiting' }
            ]
        },
        {
            taskType: 'optimization',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'plan', agent: 'opus', action: 'plan', label: 'Analyzing performance', status: 'waiting' },
                { id: 'code', agent: 'codex', action: 'implement', label: 'Optimizing code', status: 'waiting', dependsOn: ['plan'] },
                { id: 'review', agent: 'opus', action: 'review', label: 'Reviewing optimization', status: 'waiting', dependsOn: ['code'] }
            ]
        },
        {
            taskType: 'commit_message',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'commit', agent: 'haiku', action: 'generate', label: 'Generating commit message', status: 'waiting' }
            ]
        },
        {
            taskType: 'quick_question',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'answer', agent: 'sonnet', action: 'answer', label: 'Answering question', status: 'waiting' }
            ]
        },
        {
            taskType: 'unknown',
            pipeline: [
                { id: 'triage', agent: 'haiku', action: 'classify', label: 'Classifying task', status: 'waiting' },
                { id: 'plan', agent: 'opus', action: 'plan', label: 'Planning approach', status: 'waiting' },
                { id: 'code', agent: 'codex', action: 'implement', label: 'Implementing', status: 'waiting', dependsOn: ['plan'] },
                { id: 'review', agent: 'opus', action: 'review', label: 'Reviewing', status: 'waiting', dependsOn: ['code'] }
            ]
        }
    ];
}
