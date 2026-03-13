import fs from "fs/promises";
import path from "path";
import {
    NarrowRule, PathRule, RuleApplicability,
    EffectiveLanguageMeta, SupportedLanguage, RuleSource
} from "../engine/types.js";

export type AnyRule = NarrowRule | PathRule;

export interface LoadedRule {
    rule: AnyRule;
    source: RuleSource;
}

export interface LoadResult {
    rules: LoadedRule[];
    failed: string[];
}

function isPathRule(rule: unknown): rule is PathRule {
    return typeof rule === 'object' && rule !== null
        && 'id' in rule && 'phases' in rule && 'appliesTo' in rule;
}

function isNarrowRule(rule: unknown): rule is NarrowRule {
    return typeof rule === 'object' && rule !== null
        && 'id' in rule && 'check' in rule && typeof (rule as any).check === 'function';
}

/**
 * Loads shipped rules from a directory via dynamic import.
 * Each .ts file should default-export a NarrowRule or PathRule.
 */
export async function loadShippedRules(ruleDir: string): Promise<LoadResult> {
    const rules: LoadedRule[] = [];
    const failed: string[] = [];

    let entries: string[];
    try {
        entries = await fs.readdir(ruleDir);
    } catch {
        return { rules, failed };
    }

    for (const entry of entries) {
        if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
        const fullPath = path.resolve(ruleDir, entry);
        try {
            const mod = await import(fullPath);
            const exported = mod.default ?? mod;
            if (isPathRule(exported) || isNarrowRule(exported)) {
                rules.push({ rule: exported, source: 'shipped' });
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
 * Loads custom rules from explicit file paths.
 * Validates that rule IDs use the 'CUSTOM-' prefix.
 */
export async function loadCustomRules(paths: string[]): Promise<LoadResult> {
    const rules: LoadedRule[] = [];
    const failed: string[] = [];

    for (const rulePath of paths) {
        const fullPath = path.resolve(rulePath);
        try {
            const mod = await import(fullPath);
            const exported = mod.default ?? mod;

            if (isPathRule(exported)) {
                if (!exported.id.startsWith('CUSTOM-')) {
                    failed.push(fullPath);
                    continue;
                }
                rules.push({ rule: exported, source: 'custom' });
            } else if (isNarrowRule(exported)) {
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
