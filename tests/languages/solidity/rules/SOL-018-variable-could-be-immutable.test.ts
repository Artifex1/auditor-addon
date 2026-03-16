import { describe, it, expect } from 'vitest';
import { buildContext, runMapRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-018-variable-could-be-immutable.js';

describe('SOL-018: Variable could be immutable', () => {
    it('flags variable only written in constructor', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Foo {
    address owner;
    constructor() {
        owner = msg.sender;
    }
    function getOwner() external view returns (address) {
        return owner;
    }
}`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('owner');
        expect(findings[0].snippet).toContain('could be immutable');
    });

    it('does not flag variable written outside constructor', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Foo {
    address owner;
    constructor() {
        owner = msg.sender;
    }
    function transferOwnership(address newOwner) external {
        owner = newOwner;
    }
}`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag variable already marked immutable', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Foo {
    address immutable owner;
    constructor() {
        owner = msg.sender;
    }
}`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag variable never written (SOL-017 territory)', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Foo {
    uint fee = 100;
    function getFee() external view returns (uint) {
        return fee;
    }
}`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings).toHaveLength(0);
    });
});
