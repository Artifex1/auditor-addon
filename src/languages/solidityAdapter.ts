import { LanguageAdapter, Entrypoint, FunctionInsights, FileContent, SupportedLanguage } from "../engine/index.js";
import { astGrep } from "../util/astGrepCli.js";

export class SolidityAdapter implements LanguageAdapter {
    languageId = SupportedLanguage.Solidity;

    async extractEntrypoints(files: FileContent[]): Promise<Entrypoint[]> {
        const entrypoints: Entrypoint[] = [];

        for (const file of files) {
            // Find all function definitions - use flexible pattern since modifiers can be in any order
            const functions = await astGrep({
                pattern: 'function $NAME($$$) $$$',
                language: 'solidity',
                code: file.content
            });

            for (const fn of functions) {
                // Extract visibility from the match
                const visibility = this.extractVisibility(fn.text);

                // Only include public and external functions
                if (visibility === 'public' || visibility === 'external') {
                    // Extract function name from meta variables
                    const name = fn.metaVariables?.single?.NAME?.text || 'unknown';

                    // Extract contract name (search backwards from function)
                    const contractName = await this.findContractName(file.content, fn.range.start.line);

                    // Build signature (simplified for now)
                    const signature = this.buildSignature(fn.text);

                    entrypoints.push({
                        file: file.path,
                        contract: contractName,
                        name,
                        signature,
                        visibility,
                        location: {
                            line: fn.range.start.line + 1, // Convert to 1-indexed
                            column: fn.range.start.column
                        }
                    });
                }
            }
        }

        return entrypoints;
    }

    private extractVisibility(functionText: string): string {
        const visibilityMatch = functionText.match(/\b(public|external|internal|private)\b/);
        return visibilityMatch ? visibilityMatch[1] : 'public'; // default is public
    }

    private async findContractName(code: string, functionLine: number): Promise<string> {
        // Find all contracts
        const contracts = await astGrep({
            pattern: 'contract $NAME { $$$ }',
            language: 'solidity',
            code
        });

        // Find the contract that contains this function line
        for (const contract of contracts) {
            if (contract.range.start.line <= functionLine && contract.range.end.line >= functionLine) {
                return contract.metaVariables?.single?.NAME?.text || 'Unknown';
            }
        }

        return 'Unknown';
    }

    private buildSignature(functionText: string): string {
        // Extract function signature (simplified)
        const match = functionText.match(/function\s+(\w+)\s*\(([^)]*)\)/);
        if (match) {
            const name = match[1];
            const params = match[2].trim();
            return `${name}(${params})`;
        }
        return functionText.substring(0, 50); // fallback
    }

    async extractFunctionInsights(files: FileContent[], selector: any): Promise<FunctionInsights> {
        // TODO: Implement
        return {};
    }
}
