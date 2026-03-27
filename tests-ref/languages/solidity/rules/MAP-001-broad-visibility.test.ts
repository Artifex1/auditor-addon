import { describe, it, expect } from 'vitest';
import { buildContext, runMapRule } from './helpers.js';
import rule from '../../../../src/static/rules/MAP-001-broad-visibility.js';

describe('MAP-001: Broad visibility (Solidity)', () => {
    it('flags public function with no cross-module callers', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    function helper() public pure returns (uint) { return 1; }
    function main() external pure returns (uint) { return helper(); }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        const helperFindings = findings.filter(f => f.snippet.includes('helper'));
        expect(helperFindings).toHaveLength(1);
    });

    it('does not flag external function', async () => {
        const { ctx, graph } = await buildContext({
            '/test.sol': `
contract Foo {
    function main() external pure returns (uint) { return 1; }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        const mainFindings = findings.filter(f => f.snippet.includes('main'));
        expect(mainFindings).toHaveLength(0);
    });
});
