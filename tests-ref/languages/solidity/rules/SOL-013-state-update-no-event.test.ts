import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-013-state-update-no-event.js';

describe('SOL-013: State update without event', () => {
    it('detects public function with state write but no emit', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    uint public value;
    function setValue(uint v) public {
        value = v;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('state write');
    });

    it('does not flag when emit is present', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    uint public value;
    event ValueSet(uint);
    function setValue(uint v) public {
        value = v;
        emit ValueSet(v);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag private function', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    uint value;
    function _set(uint v) private {
        value = v;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
