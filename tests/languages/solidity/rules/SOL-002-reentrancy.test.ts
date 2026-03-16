import { describe, it, expect } from 'vitest';
import { buildContext, runDeepRuleOnFunction } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-002-reentrancy.js';

describe('SOL-002: Reentrancy', () => {
    it('detects state write after external call in same function', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;
    function withdraw(uint amount) external {
        msg.sender.call{value: amount}("");
        balances[msg.sender] -= amount;
    }
}`,
        });
        const findings = await runDeepRuleOnFunction(ctx, symbolMap, 'withdraw', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('state write');
        expect(findings[0].executionPath).toBeDefined();
        expect(findings[0].executionPath!.length).toBe(2);
    });

    it('does not flag when state write is before external call', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;
    function withdraw(uint amount) external {
        balances[msg.sender] -= amount;
        msg.sender.call{value: amount}("");
    }
}`,
        });
        const findings = await runDeepRuleOnFunction(ctx, symbolMap, 'withdraw', rule);
        expect(findings).toHaveLength(0);
    });

    it('detects reentrancy across functions — external call in callee, write in caller', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;

    function withdraw(uint amount) external {
        _sendFunds(msg.sender, amount);
        balances[msg.sender] -= amount;
    }

    function _sendFunds(address to, uint amount) internal {
        to.call{value: amount}("");
    }
}`,
        });
        const findings = await runDeepRuleOnFunction(ctx, symbolMap, 'withdraw', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].executionPath!.length).toBe(2);
    });

    it('detects reentrancy across 3 functions — deep call chain', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;

    function withdraw(uint amount) external {
        _process(msg.sender, amount);
        balances[msg.sender] -= amount;
    }

    function _process(address to, uint amount) internal {
        _doTransfer(to, amount);
    }

    function _doTransfer(address to, uint amount) internal {
        to.call{value: amount}("");
    }
}`,
        });
        const findings = await runDeepRuleOnFunction(ctx, symbolMap, 'withdraw', rule);
        expect(findings).toHaveLength(1);
    });

    it('detects reentrancy across two files', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/vault.sol': `
contract Vault {
    mapping(address => uint) balances;

    function withdraw(uint amount) external {
        _sendFunds(msg.sender, amount);
        balances[msg.sender] -= amount;
    }
}`,
            '/sender.sol': `
contract Sender {
    function _sendFunds(address to, uint amount) internal {
        to.call{value: amount}("");
    }
}`,
        });
        const findings = await runDeepRuleOnFunction(ctx, symbolMap, 'withdraw', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag when no external call in the chain', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;
    uint total;

    function update(uint amount) external {
        _compute(amount);
        balances[msg.sender] = amount;
    }

    function _compute(uint amount) internal pure returns (uint) {
        return amount * 2;
    }
}`,
        });
        const findings = await runDeepRuleOnFunction(ctx, symbolMap, 'update', rule);
        expect(findings).toHaveLength(0);
    });
});
