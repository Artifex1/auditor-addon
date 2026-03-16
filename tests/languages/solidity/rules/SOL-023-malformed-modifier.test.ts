import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-023-malformed-modifier.js';

describe('SOL-023: Malformed modifier', () => {
    it('flags modifier with bare comparison', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address owner;
    modifier onlyOwner() {
        msg.sender == owner;
        _;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('bare comparison');
        expect(findings[0].snippet).toContain('onlyOwner');
    });

    it('does not flag modifier with require', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address owner;
    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('flags modifier with bare logical expression', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address owner;
    bool active;
    modifier onlyActiveOwner() {
        msg.sender == owner && active;
        _;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag modifier with if-revert', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address owner;
    modifier onlyOwner() {
        if (msg.sender != owner) revert("not owner");
        _;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
