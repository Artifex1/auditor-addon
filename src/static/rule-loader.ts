import path from "path";
import {
    Rule, MapRule, RuleApplicability,
    EffectiveLanguageMeta, SupportedLanguage, RuleSource
} from "../engine/types.js";

export type AnyRule = Rule | MapRule;

export interface LoadedRule {
    rule: AnyRule;
    source: RuleSource;
}

export interface LoadResult {
    rules: LoadedRule[];
    failed: string[];
}

function isRule(rule: unknown): rule is Rule {
    return typeof rule === 'object' && rule !== null
        && 'id' in rule && 'finalize' in rule && typeof (rule as any).finalize === 'function';
}

function isMapRule(rule: unknown): rule is MapRule {
    return typeof rule === 'object' && rule !== null
        && 'id' in rule && 'check' in rule && typeof (rule as any).check === 'function'
        && !('finalize' in rule);
}

/**
 * Loads custom rules from explicit file paths.
 * Accepts .ts files (compiled via tsx at runtime) and .js files.
 * Rule IDs must use the 'CUSTOM-' prefix.
 */
export async function loadCustomRules(paths: string[]): Promise<LoadResult> {
    const rules: LoadedRule[] = [];
    const failed: string[] = [];

    for (const rulePath of paths) {
        const fullPath = path.resolve(rulePath);
        try {
            let mod: any;
            if (fullPath.endsWith('.ts')) {
                const { tsImport } = await import('tsx/esm/api');
                mod = await tsImport(fullPath, import.meta.url);
            } else {
                mod = await import(fullPath);
            }

            const exported = mod.default ?? mod;

            if (isRule(exported) || isMapRule(exported)) {
                if (!exported.id.startsWith('CUSTOM-')) {
                    failed.push(fullPath);
                    continue;
                }
                rules.push({ rule: exported, source: 'custom' });
            } else {
                failed.push(fullPath);
            }
        } catch {
            failed.push(fullPath);
        }
    }

    return { rules, failed };
}

/**
 * Checks whether a rule applies to the current scan context.
 * All specified criteria must match (AND); within each criterion,
 * any match suffices (OR).
 */
export function ruleApplies(
    appliesTo: RuleApplicability,
    meta: EffectiveLanguageMeta,
    lang: SupportedLanguage
): boolean {
    if (appliesTo.languages && !appliesTo.languages.includes(lang)) return false;
    if (appliesTo.domains && !appliesTo.domains.includes(meta.domain)) return false;
    if (appliesTo.inheritanceModels && !appliesTo.inheritanceModels.includes(meta.inheritanceModel)) return false;
    if (appliesTo.frameworks && meta.framework && !appliesTo.frameworks.includes(meta.framework)) return false;
    if (appliesTo.frameworks && !meta.framework) return false;
    return true;
}
