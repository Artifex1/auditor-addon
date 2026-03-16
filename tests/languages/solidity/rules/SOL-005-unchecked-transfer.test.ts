import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-005-unchecked-transfer.js';

describe('SOL-005: Unchecked ERC20 transfer', () => {
    it('detects unchecked token.transfer()', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad(address token) external {
        IERC20(token).transfer(msg.sender, 100);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag checked transfer', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function ok(address token) external {
        bool success = IERC20(token).transfer(msg.sender, 100);
        require(success);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag payable.transfer (ETH)', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function ok() external {
        payable(msg.sender).transfer(1 ether);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
