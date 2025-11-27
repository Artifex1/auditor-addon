import { LanguageAdapter, Entrypoint, FunctionInsights, FileContent, SupportedLanguage } from "../engine/index.js";
import { astGrep } from "../util/astGrepCli.js";

export class SolidityAdapter implements LanguageAdapter {
    languageId = SupportedLanguage.Solidity;

    async extractEntrypoints(files: FileContent[]): Promise<Entrypoint[]> {
        const entrypoints: Entrypoint[] = [];

        const functionRule = `
id: public_or_external_function
language: Solidity
kind: function_definition
rule:
  pattern: "function $NAME($$$) $$$MODIFIERS { $$$ }"
`;

        for (const file of files) {
            // Find public and external function definitions using ast-grep rule
            const functions = await astGrep({
                inlineRule: functionRule,
                code: file.content
            });

            for (const fn of functions) {
                const modifiers: string[] =
  fn.metaVariables?.multi?.MODIFIERS?.map((m: { text: string }) => m.text) ?? [];
                
                const visibility = modifiers.find(
                    (m): m is 'external' | 'public' => m === 'external' || m === 'public',
                );
                if (!visibility) continue;

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

        return entrypoints;
    }

    private async findContractName(code: string, functionLine: number): Promise<string> {
        // Find contracts (supports both `contract` and `abstract contract`) via inline YAML rule
        const inlineRule = `
id: contract
language: Solidity
kind: contract_definition
rule:
  any:
    - pattern: "contract $NAME { $$$ }"
    - pattern: "contract $NAME is $$$ { $$$ }"
    - pattern: "abstract contract $NAME { $$$ }"
    - pattern: "abstract contract $NAME is $$$ { $$$ }"
`;

        const contractMatches = await astGrep({
            inlineRule,
            code
        });

        for (const contract of contractMatches) {
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
