import { describe, it, expect } from 'vitest';
import { ruleApplies } from '../../src/static/rule-loader.js';
import {
    SupportedLanguage, EffectiveLanguageMeta, RuleApplicability
} from '../../src/engine/types.js';

describe('ruleApplies', () => {
    const solidityMeta: EffectiveLanguageMeta = {
        domain: 'on-chain',
        inheritanceModel: 'classical',
    };

    const rustMeta: EffectiveLanguageMeta = {
        domain: 'off-chain',
        inheritanceModel: 'trait-based',
    };

    const anchorMeta: EffectiveLanguageMeta = {
        domain: 'on-chain',
        inheritanceModel: 'trait-based',
        framework: 'anchor',
    };

    it('returns true when appliesTo is empty (matches everything)', () => {
        expect(ruleApplies({}, solidityMeta, SupportedLanguage.Solidity)).toBe(true);
    });

    it('filters by language', () => {
        const appliesTo: RuleApplicability = {
            languages: [SupportedLanguage.Solidity],
        };
        expect(ruleApplies(appliesTo, solidityMeta, SupportedLanguage.Solidity)).toBe(true);
        expect(ruleApplies(appliesTo, rustMeta, SupportedLanguage.Rust)).toBe(false);
    });

    it('filters by domain', () => {
        const appliesTo: RuleApplicability = {
            domains: ['on-chain'],
        };
        expect(ruleApplies(appliesTo, solidityMeta, SupportedLanguage.Solidity)).toBe(true);
        expect(ruleApplies(appliesTo, rustMeta, SupportedLanguage.Rust)).toBe(false);
    });

    it('filters by inheritance model', () => {
        const appliesTo: RuleApplicability = {
            inheritanceModels: ['classical'],
        };
        expect(ruleApplies(appliesTo, solidityMeta, SupportedLanguage.Solidity)).toBe(true);
        expect(ruleApplies(appliesTo, rustMeta, SupportedLanguage.Rust)).toBe(false);
    });

    it('filters by framework — matches when present', () => {
        const appliesTo: RuleApplicability = {
            frameworks: ['anchor'],
        };
        expect(ruleApplies(appliesTo, anchorMeta, SupportedLanguage.Rust)).toBe(true);
    });

    it('filters by framework — rejects when no framework set', () => {
        const appliesTo: RuleApplicability = {
            frameworks: ['anchor'],
        };
        expect(ruleApplies(appliesTo, solidityMeta, SupportedLanguage.Solidity)).toBe(false);
    });

    it('filters by framework — rejects wrong framework', () => {
        const appliesTo: RuleApplicability = {
            frameworks: ['starknet'],
        };
        expect(ruleApplies(appliesTo, anchorMeta, SupportedLanguage.Rust)).toBe(false);
    });

    it('ANDs multiple criteria together', () => {
        const appliesTo: RuleApplicability = {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
            inheritanceModels: ['classical'],
        };
        expect(ruleApplies(appliesTo, solidityMeta, SupportedLanguage.Solidity)).toBe(true);

        // Language match but domain mismatch
        const offchainSolidity: EffectiveLanguageMeta = {
            domain: 'off-chain',
            inheritanceModel: 'classical',
        };
        expect(ruleApplies(appliesTo, offchainSolidity, SupportedLanguage.Solidity)).toBe(false);
    });

    it('ORs within each criterion (multiple languages)', () => {
        const appliesTo: RuleApplicability = {
            languages: [SupportedLanguage.Solidity, SupportedLanguage.Rust],
        };
        expect(ruleApplies(appliesTo, solidityMeta, SupportedLanguage.Solidity)).toBe(true);
        expect(ruleApplies(appliesTo, rustMeta, SupportedLanguage.Rust)).toBe(true);
        expect(ruleApplies(appliesTo, rustMeta, SupportedLanguage.Go)).toBe(false);
    });
});
