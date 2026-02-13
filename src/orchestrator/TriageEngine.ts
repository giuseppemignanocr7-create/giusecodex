import { TaskType, SYSTEM_PROMPTS } from './types';
import { AIProviderManager } from '../providers/AIProviderManager';

interface TriageResult {
    taskType: TaskType;
    confidence: number;
    reasoning: string;
}

const VALID_TASK_TYPES: TaskType[] = [
    'new_feature', 'bug_fix', 'refactor', 'explain', 'test_generation',
    'code_review', 'documentation', 'optimization', 'commit_message',
    'quick_question', 'unknown'
];

const KEYWORD_RULES: Array<{ pattern: RegExp; taskType: TaskType }> = [
    { pattern: /\b(fix|bug|error|crash|broken|issue|wrong|fail)\b/i, taskType: 'bug_fix' },
    { pattern: /\b(explain|what does|how does|why does|what is|describe)\b/i, taskType: 'explain' },
    { pattern: /\b(refactor|clean up|restructure|simplify|reorganize)\b/i, taskType: 'refactor' },
    { pattern: /\b(test|spec|coverage|unit test|integration test)\b/i, taskType: 'test_generation' },
    { pattern: /\b(review|code review|check quality|audit)\b/i, taskType: 'code_review' },
    { pattern: /\b(doc|document|readme|jsdoc|comment)\b/i, taskType: 'documentation' },
    { pattern: /\b(optimi[sz]e|performance|speed up|faster|slow)\b/i, taskType: 'optimization' },
    { pattern: /\b(commit message|git commit|changelog)\b/i, taskType: 'commit_message' },
    { pattern: /\b(add|create|build|implement|new|feature|generate)\b/i, taskType: 'new_feature' }
];

export class TriageEngine {
    constructor(private readonly aiProvider: AIProviderManager) {}

    public async classify(
        userPrompt: string,
        context: string,
        model: string,
        signal?: AbortSignal
    ): Promise<{ result: TriageResult; inputTokens: number; outputTokens: number; costUsd: number }> {
        try {
            const prompt = context
                ? `User message: ${userPrompt}\n\nContext:\n${context}`
                : `User message: ${userPrompt}`;

            const response = await this.aiProvider.requestTabCompletion({
                prompt,
                model,
                systemPrompt: SYSTEM_PROMPTS.haiku,
                maxTokens: 256,
                signal
            });

            const parsed = this.parseTriageResponse(response.text);

            return {
                result: parsed,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                costUsd: response.costUsd
            };
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw error;
            }

            const fallback = this.fallbackClassify(userPrompt);
            return {
                result: fallback,
                inputTokens: 0,
                outputTokens: 0,
                costUsd: 0
            };
        }
    }

    public fallbackClassify(userPrompt: string): TriageResult {
        const lower = userPrompt.toLowerCase();

        for (const rule of KEYWORD_RULES) {
            if (rule.pattern.test(lower)) {
                return {
                    taskType: rule.taskType,
                    confidence: 0.6,
                    reasoning: `Keyword fallback: matched pattern for ${rule.taskType}`
                };
            }
        }

        return {
            taskType: 'unknown',
            confidence: 0.3,
            reasoning: 'No keyword match; defaulting to unknown pipeline'
        };
    }

    private parseTriageResponse(raw: string): TriageResult {
        const trimmed = raw.trim();

        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return {
                taskType: 'unknown',
                confidence: 0.4,
                reasoning: 'Could not parse triage JSON from model output'
            };
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

            const taskType = String(parsed.taskType ?? parsed.task_type ?? 'unknown');
            const confidence = Number(parsed.confidence ?? 0.5);
            const reasoning = String(parsed.reasoning ?? '');

            if (!VALID_TASK_TYPES.includes(taskType as TaskType)) {
                return {
                    taskType: 'unknown',
                    confidence: 0.4,
                    reasoning: `Model returned invalid task type: ${taskType}`
                };
            }

            return {
                taskType: taskType as TaskType,
                confidence: Math.max(0, Math.min(1, confidence)),
                reasoning
            };
        } catch {
            return {
                taskType: 'unknown',
                confidence: 0.4,
                reasoning: 'JSON parse error in triage response'
            };
        }
    }
}
