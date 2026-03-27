import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-026-rounding-direction-in-branch.js';

describe('SOL-026: Rounding direction in branch condition', () => {
    it('flags mulFloor in if condition', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
library DecimalMath {
    function mulFloor(uint a, uint b) internal pure returns (uint) { return a * b / 1e18; }
}
contract MagicLP {
    using DecimalMath for uint;
    uint _I_;
    function buyShares() external {
        uint baseBalance = 100;
        uint quoteBalance = 1;
        uint shares;
        if (quoteBalance < baseBalance.mulFloor(_I_)) {
            shares = quoteBalance / _I_;
        } else {
            shares = baseBalance;
        }
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('rounding in branch');
    });

    it('flags mulDivDown in ternary', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
library Math {
    function mulDivDown(uint a, uint b, uint c) internal pure returns (uint) { return a * b / c; }
}
contract Foo {
    using Math for uint;
    function calc(uint a, uint b, uint c) external pure returns (uint) {
        return a.mulDivDown(b, c) > 100 ? a : b;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag rounding outside branch condition', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
library DecimalMath {
    function mulFloor(uint a, uint b) internal pure returns (uint) { return a * b / 1e18; }
}
contract Foo {
    using DecimalMath for uint;
    function calc(uint a, uint b) external pure returns (uint) {
        return a.mulFloor(b);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
