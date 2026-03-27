import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-006-floating-pragma.js';

describe('SOL-006: Floating pragma', () => {
    it('detects ^0.8.0 pragma', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('detects range pragma', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity >=0.8.0 <0.9.0;
contract Foo {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag pinned pragma', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity 0.8.19;
contract Foo {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
