import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-001-unchecked-call.js';

describe('SOL-001: Unchecked Low-Level Call', () => {
    it('detects unchecked .call()', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad() external {
        address(this).call("");
    }
}`,
        });
        const instances = await runRule(ctx, '/test.sol', rule);
        expect(instances).toHaveLength(1);
        expect(instances[0].location.file).toBe('/test.sol');
        expect(instances[0].snippet).toContain('call');
    });

    it('does not flag checked .call() with assignment', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function safe() external {
        (bool ok, ) = address(this).call("");
        require(ok);
    }
}`,
        });
        const instances = await runRule(ctx, '/test.sol', rule);
        expect(instances).toHaveLength(0);
    });

    it('detects unchecked .send()', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad() external {
        payable(msg.sender).send(1 ether);
    }
}`,
        });
        const instances = await runRule(ctx, '/test.sol', rule);
        expect(instances).toHaveLength(1);
    });

    it('detects multiple unchecked calls in one contract', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function a() external {
        address(this).call("");
    }
    function b() external {
        address(this).delegatecall("");
    }
}`,
        });
        const instances = await runRule(ctx, '/test.sol', rule);
        expect(instances).toHaveLength(2);
    });
});
