import { PlanSection } from './types';

function extractTag(xml: string, tag: string): string {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const startIndex = xml.indexOf(openTag);
    if (startIndex === -1) {
        return '';
    }

    const contentStart = startIndex + openTag.length;
    const endIndex = xml.indexOf(closeTag, contentStart);
    if (endIndex === -1) {
        return xml.slice(contentStart).trim();
    }

    return xml.slice(contentStart, endIndex).trim();
}

export class PlanParser {
    public parse(rawOutput: string): PlanSection {
        const planBlock = extractTag(rawOutput, 'plan');
        const source = planBlock || rawOutput;

        const architecture = extractTag(source, 'architecture');
        const designSpec = extractTag(source, 'design_spec');
        const codeSpec = extractTag(source, 'code_spec');
        const fileStructure = extractTag(source, 'file_structure');
        const warningsRaw = extractTag(source, 'warnings');
        const parallelRaw = extractTag(source, 'parallel');

        const parallel = parallelRaw.toLowerCase() === 'true';

        return {
            architecture: architecture || undefined,
            designSpec: designSpec || undefined,
            codeSpec: codeSpec || undefined,
            fileStructure: fileStructure || undefined,
            warnings: warningsRaw || undefined,
            parallel
        };
    }

    public buildDesignPrompt(plan: PlanSection, userPrompt: string, context: string): string {
        const parts = [
            '## User Request',
            userPrompt,
            ''
        ];

        if (plan.architecture) {
            parts.push('## Architecture', plan.architecture, '');
        }

        if (plan.designSpec) {
            parts.push('## Design Specification', plan.designSpec, '');
        }

        if (plan.fileStructure) {
            parts.push('## File Structure', plan.fileStructure, '');
        }

        if (context) {
            parts.push('## Context', context, '');
        }

        parts.push('Produce detailed design output based on the above plan.');

        return parts.join('\n');
    }

    public buildCodePrompt(plan: PlanSection, userPrompt: string, context: string, designOutput?: string): string {
        const parts = [
            '## User Request',
            userPrompt,
            ''
        ];

        if (plan.architecture) {
            parts.push('## Architecture', plan.architecture, '');
        }

        if (plan.codeSpec) {
            parts.push('## Code Specification', plan.codeSpec, '');
        }

        if (plan.fileStructure) {
            parts.push('## File Structure', plan.fileStructure, '');
        }

        if (designOutput) {
            parts.push('## Design Output (from Sonnet)', designOutput, '');
        }

        if (context) {
            parts.push('## Context', context, '');
        }

        parts.push('Produce complete, production-ready code based on the above plan.');

        return parts.join('\n');
    }

    public buildReviewPrompt(plan: PlanSection, designOutput: string, codeOutput: string): string {
        const parts = [
            '## Original Plan'
        ];

        if (plan.architecture) {
            parts.push('### Architecture', plan.architecture, '');
        }

        if (plan.designSpec) {
            parts.push('### Design Spec', plan.designSpec, '');
        }

        if (plan.codeSpec) {
            parts.push('### Code Spec', plan.codeSpec, '');
        }

        parts.push('## Design Output', designOutput || '(no design output)', '');
        parts.push('## Code Output', codeOutput || '(no code output)', '');
        parts.push('Review the above outputs against the plan. Respond with the JSON format specified in your system prompt.');

        return parts.join('\n');
    }

    public buildFixPrompt(codeOutput: string, reviewResult: string, plan: PlanSection): string {
        const parts = [
            '## Review Feedback',
            reviewResult,
            '',
            '## Original Code',
            codeOutput,
            ''
        ];

        if (plan.codeSpec) {
            parts.push('## Original Code Spec', plan.codeSpec, '');
        }

        parts.push('Fix the critical and high severity issues identified in the review. Output the complete corrected code.');

        return parts.join('\n');
    }
}
