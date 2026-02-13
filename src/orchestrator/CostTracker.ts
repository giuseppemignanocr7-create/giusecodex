import { AgentRole, SessionStats } from './types';

function emptyAgentStats(): { requests: number; inputTokens: number; outputTokens: number; costUsd: number } {
    return { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

export class CostTracker {
    private stats: SessionStats = {
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        perAgent: {
            haiku: emptyAgentStats(),
            opus: emptyAgentStats(),
            sonnet: emptyAgentStats(),
            codex: emptyAgentStats()
        }
    };

    public record(agent: AgentRole, inputTokens: number, outputTokens: number, costUsd: number): void {
        this.stats.totalRequests += 1;
        this.stats.totalInputTokens += inputTokens;
        this.stats.totalOutputTokens += outputTokens;
        this.stats.totalCostUsd += costUsd;

        const bucket = this.stats.perAgent[agent];
        bucket.requests += 1;
        bucket.inputTokens += inputTokens;
        bucket.outputTokens += outputTokens;
        bucket.costUsd += costUsd;
    }

    public getStats(): SessionStats {
        return JSON.parse(JSON.stringify(this.stats)) as SessionStats;
    }

    public getTotalCost(): number {
        return this.stats.totalCostUsd;
    }

    public getAgentCost(agent: AgentRole): number {
        return this.stats.perAgent[agent].costUsd;
    }

    public reset(): void {
        this.stats = {
            totalRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCostUsd: 0,
            perAgent: {
                haiku: emptyAgentStats(),
                opus: emptyAgentStats(),
                sonnet: emptyAgentStats(),
                codex: emptyAgentStats()
            }
        };
    }

    public formatSummary(): string {
        const s = this.stats;
        const lines = [
            `## Orchestration Cost Report`,
            ``,
            `- Total requests: **${s.totalRequests}**`,
            `- Total tokens: **${(s.totalInputTokens + s.totalOutputTokens).toLocaleString()}** (${s.totalInputTokens.toLocaleString()} in / ${s.totalOutputTokens.toLocaleString()} out)`,
            `- Total cost: **$${s.totalCostUsd.toFixed(4)}**`,
            ``
        ];

        const agents: AgentRole[] = ['haiku', 'opus', 'sonnet', 'codex'];
        for (const agent of agents) {
            const a = s.perAgent[agent];
            if (a.requests > 0) {
                lines.push(`### ${agent.charAt(0).toUpperCase() + agent.slice(1)}`);
                lines.push(`- Requests: ${a.requests} | Tokens: ${(a.inputTokens + a.outputTokens).toLocaleString()} | Cost: $${a.costUsd.toFixed(4)}`);
                lines.push(``);
            }
        }

        return lines.join('\n');
    }
}
