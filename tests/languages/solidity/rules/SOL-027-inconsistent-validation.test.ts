import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-027-inconsistent-validation.js';

describe('SOL-027: Inconsistent validation vs assignment', () => {
    it('flags when guard uses block.timestamp but assignment uses lastLockTime', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract LockManager {
    struct Lock { uint32 lastLockTime; uint32 unlockTime; }
    mapping(address => Lock) public locks;
    function setLockDuration(uint256 _duration) external {
        Lock storage lock = locks[msg.sender];
        if (uint32(block.timestamp) + uint32(_duration) < lock.unlockTime) {
            revert("reduced");
        }
        lock.unlockTime = lock.lastLockTime + uint32(_duration);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('different base');
    });

    it('does not flag when guard and assignment use same expression', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract LockManager {
    struct Lock { uint32 lastLockTime; uint32 unlockTime; }
    mapping(address => Lock) public locks;
    function setLockDuration(uint256 _duration) external {
        Lock storage lock = locks[msg.sender];
        if (lock.lastLockTime + uint32(_duration) < lock.unlockTime) {
            revert("reduced");
        }
        lock.unlockTime = lock.lastLockTime + uint32(_duration);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
