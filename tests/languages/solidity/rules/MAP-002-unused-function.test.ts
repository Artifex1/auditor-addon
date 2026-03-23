import { describe, it, expect } from 'vitest';
import { buildContext, runMapRule } from './helpers.js';
import rule from '../../../../src/static/rules/MAP-002-unused-function.js';

describe('MAP-002: Unused function (Solidity)', () => {
    it('flags unused private function', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    function _unused() private pure returns (uint) { return 1; }
    function main() external pure returns (uint) { return 2; }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings.some(f => f.snippet.includes('_unused'))).toBe(true);
    });

    it('does not flag called private function', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    function _helper() private pure returns (uint) { return 1; }
    function main() external pure returns (uint) { return _helper(); }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings.some(f => f.snippet.includes('_helper'))).toBe(false);
    });
});
