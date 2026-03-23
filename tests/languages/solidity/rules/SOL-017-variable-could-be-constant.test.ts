import { describe, it, expect } from 'vitest';
import { buildContext, runMapRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-017-variable-could-be-constant.js';

describe('SOL-017: Variable could be constant', () => {
    it('flags initialized variable that is never written', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    uint fee = 100;
    function getFee() external view returns (uint) {
        return fee;
    }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('fee');
        expect(findings[0].snippet).toContain('could be constant');
    });

    it('does not flag variable that is written', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    uint fee = 100;
    function setFee(uint f) external {
        fee = f;
    }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag variable already marked constant', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    uint constant FEE = 100;
    function getFee() external pure returns (uint) {
        return FEE;
    }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag variable already marked immutable', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    uint immutable fee;
    constructor() { fee = 100; }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag variable without initializer', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    uint fee;
    function getFee() external view returns (uint) {
        return fee;
    }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings).toHaveLength(0);
    });
});
