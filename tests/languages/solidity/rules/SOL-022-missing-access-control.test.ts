import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-022-missing-access-control.js';

describe('SOL-022: Missing access control on setter', () => {
    it('flags public setter without access control', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address public curves;
    function setCurves(address _curves) public {
        curves = _curves;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('setCurves');
        expect(findings[0].snippet).toContain('without access control');
    });

    it('does not flag function with onlyOwner modifier', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address public owner;
    address public curves;
    modifier onlyOwner() { require(msg.sender == owner); _; }
    function setCurves(address _curves) public onlyOwner {
        curves = _curves;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag function with msg.sender check', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address public owner;
    address public target;
    function setTarget(address _target) public {
        require(msg.sender == owner, "not owner");
        target = _target;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag view function', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    uint public value;
    function getValue() public view returns (uint) {
        return value;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag internal function', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    uint public value;
    function _setValue(uint v) internal {
        value = v;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag constructor', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    address public owner;
    constructor() {
        owner = msg.sender;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
