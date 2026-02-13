import { MergedOutput } from './types';

const FILE_PATH_REGEX = /```([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)\n/g;

export class ResultMerger {
    public merge(designOutput: string, codeOutput: string): MergedOutput {
        const files = this.extractFilePaths(codeOutput);
        const designFiles = this.extractFilePaths(designOutput);

        const allFiles = [...new Set([...files, ...designFiles])];

        const combined = this.buildCombined(designOutput, codeOutput);

        return {
            design: designOutput,
            code: codeOutput,
            combined,
            files: allFiles
        };
    }

    public mergeWithFix(original: MergedOutput, fixedCode: string): MergedOutput {
        const fixedFiles = this.extractFilePaths(fixedCode);
        const allFiles = [...new Set([...original.files, ...fixedFiles])];

        const combined = this.buildCombined(original.design, fixedCode);

        return {
            design: original.design,
            code: fixedCode,
            combined,
            files: allFiles
        };
    }

    private extractFilePaths(text: string): string[] {
        const paths: string[] = [];
        let match: RegExpExecArray | null;

        const regex = new RegExp(FILE_PATH_REGEX.source, FILE_PATH_REGEX.flags);
        while ((match = regex.exec(text)) !== null) {
            const filePath = match[1];
            if (filePath && !paths.includes(filePath)) {
                paths.push(filePath);
            }
        }

        return paths;
    }

    private buildCombined(design: string, code: string): string {
        const parts: string[] = [];

        if (design && design.trim()) {
            parts.push('## Design\n\n' + design.trim());
        }

        if (code && code.trim()) {
            parts.push('## Implementation\n\n' + code.trim());
        }

        return parts.join('\n\n---\n\n');
    }
}
