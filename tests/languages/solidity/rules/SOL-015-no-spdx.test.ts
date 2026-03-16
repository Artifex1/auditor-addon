import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-015-no-spdx.js';

describe('SOL-015: No SPDX', () => {
    it('detects missing SPDX', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity 0.8.19;
contract Foo {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag with SPDX present', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
contract Foo {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
