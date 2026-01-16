import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../../src/languages/solidityAdapter.js';

describe('SolidityAdapter Metrics', () => {
    const adapter = new SolidityAdapter();

    it('should extract signatures from Solidity code', async () => {
        const content = `
            pragma solidity ^0.8.0;
            
            contract Test {
                function foo() external {}
                function bar(uint a) public returns (uint) { return a; }
            }
        `;

        const signaturesByFile = await adapter.extractSignatures([{ path: 'Test.sol', content }]);
        const allSignatures = Object.values(signaturesByFile).flat();
        expect(allSignatures.length).toBeGreaterThan(0);
        expect(allSignatures.some(s => s.includes('foo()'))).toBe(true);
        expect(allSignatures.some(s => s.includes('bar'))).toBe(true);
    });

    it('should calculate metrics for simple Solidity code', async () => {
        const content = `contract Simple {
    function test() public {
        uint x = 1;
    }
}`;
        // Analysis:
        // Total lines: 5
        // Blank lines: 0
        // Comment-only lines: 0
        // Multi-line normalization: function signature spans 1 line (no adjustment)
        // NLoC = 5 - 0 - 0 - 0 = 5
        // Cognitive complexity: 0 (no branches)
        // Comment density: 0%

        const metrics = await adapter.calculateMetrics([{ path: 'Simple.sol', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(5);
        expect(metrics[0].cognitiveComplexity).toBe(0);
        expect(metrics[0].linesWithComments).toBe(0);
        expect(metrics[0].commentDensity).toBe(0);
    });

    it('should calculate metrics with nested complexity', async () => {
        const content = `contract Complex {
    function test(uint n) public {
        if (n > 0) {
            for (uint i = 0; i < n; i++) {
                // comment
            }
        }
    }
}`;
        // Analysis:
        // Total lines: 9
        // Blank lines: 0
        // Comment-only lines: 1 (line 5: "// comment")
        // Multi-line normalization: function signature spans 1 line (no adjustment)
        // NLoC = 9 - 0 - 1 - 0 = 8
        // Cognitive complexity: if (level 0) = 1, for (level 1) = 1 + 1 = 2, total = 3
        // Lines with comments: 1
        // Comment density: (1 / 8) * 100 = 12.5%

        const metrics = await adapter.calculateMetrics([{ path: 'Complex.sol', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(8);
        expect(metrics[0].cognitiveComplexity).toBe(3);
        expect(metrics[0].linesWithComments).toBe(1);
        expect(metrics[0].commentDensity).toBe(12.5);
    });

    it('should calculate metrics with multi-line function signatures', async () => {
        const content = `contract MultiLine {
    function complexFunction(
        uint256 param1,
        address param2
    ) public returns (uint256) {
        return param1;
    }
}`;
        // Analysis:
        // Total lines: 8
        // Blank lines: 0
        // Comment-only lines: 0
        // Multi-line normalization: function signature spans lines 2-5 (4 lines total)
        //   The body starts at line 5 (after the closing paren)
        //   Signature is from line 2 to line 5 (start of body) - 1 = line 4
        //   Lines spanned: 4 - 2 + 1 = 3 lines
        //   Adjustment: 3 - 1 = 2 lines
        // NLoC = 8 - 0 - 0 - 2 = 6
        // Cognitive complexity: 0 (no branches)
        // Comment density: 0%

        const metrics = await adapter.calculateMetrics([{ path: 'MultiLine.sol', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(6);
        expect(metrics[0].cognitiveComplexity).toBe(0);
        expect(metrics[0].commentDensity).toBe(0);
    });

    it('should calculate metrics with comments and blank lines', async () => {
        const content = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice This is a documented contract
contract Documented {
    // Internal state variable
    uint256 private value;

    /// @notice Sets the value
    /// @param newValue The new value to set
    function setValue(uint256 newValue) public {
        value = newValue;
    }
}`;
        // Analysis:
        // Total lines: 14
        // Blank lines: 2 (lines 3, 8)
        // Comment-only lines: 5 (lines 1, 4, 6, 9, 10)
        // Multi-line normalization: function signature spans 1 line (no adjustment)
        // NLoC = 14 - 2 - 5 - 0 = 7
        // Cognitive complexity: 0 (no branches)
        // Lines with comments: 5
        // Comment density: (5 / 7) * 100 = 71.43%

        const metrics = await adapter.calculateMetrics([{ path: 'Documented.sol', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(7);
        expect(metrics[0].cognitiveComplexity).toBe(0);
        expect(metrics[0].linesWithComments).toBe(5);
        expect(metrics[0].commentDensity).toBe(71.43);
    });

    it('should calculate metrics with deeply nested branches', async () => {
        const content = `contract DeepNesting {
    function complex(uint a, uint b, uint c) public {
        if (a > 0) {
            if (b > 0) {
                if (c > 0) {
                    return;
                }
            }
        }
    }
}`;
        // Analysis:
        // Total lines: 11
        // Blank lines: 0
        // Comment-only lines: 0
        // Multi-line normalization: 0
        // NLoC = 11 - 0 - 0 - 0 = 11
        // Cognitive complexity:
        //   - if (a > 0) at level 0: 1
        //   - if (b > 0) at level 1: 1 + 1 = 2
        //   - if (c > 0) at level 2: 1 + 2 = 3
        //   Total: 1 + 2 + 3 = 6
        // Comment density: 0%

        const metrics = await adapter.calculateMetrics([{ path: 'DeepNesting.sol', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(11);
        expect(metrics[0].cognitiveComplexity).toBe(6);
        expect(metrics[0].commentDensity).toBe(0);
    });

    it('should calculate estimated hours based on complexity and documentation', async () => {
        const content = `contract Estimation {
    /// @notice Well documented function
    function simple() public {
        uint x = 1;
    }
}`;
        // Analysis:
        // NLoC = 6 - 0 - 1 - 0 = 5
        // Cognitive complexity: 0
        // Lines with comments: 1
        // Comment density: (1 / 5) * 100 = 20%
        // Normalized complexity: (0 / 5) * 100 = 0 per 100 NLoC
        //
        // Estimation (using Solidity constants):
        // baseRateNlocPerDay = 250
        // complexityMidpoint = 11
        // complexitySteepness = 8
        // complexityBenefitCap = 0.25
        // complexityPenaltyCap = 0.75
        // commentFullBenefitDensity = 20
        // commentBenefitCap = 0.35
        //
        // baseHours = (5 / 250) * 8 = 0.16 hours
        // complexityDelta = 0 - 11 = -11
        // complexityShape = tanh(-11 / 8) = tanh(-1.375) ≈ -0.8807
        // complexityAdjustment = -0.8807 * 0.25 ≈ -0.2202
        // commentDensityProgress = 20 / 20 = 1.0
        // commentShape = tanh(1.0 * 2.646) = tanh(2.646) ≈ 0.9899
        // commentAdjustment = 0.9899 * 0.35 ≈ 0.3465
        // factor = 1.0 + (-0.2202) - 0.3465 = 0.4333
        // factor clamped to [0.5, 1.75] = 0.5 (minimum)
        // estimatedHours = 0.16 * 0.5 = 0.08 hours

        const metrics = await adapter.calculateMetrics([{ path: 'Estimation.sol', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(5);
        expect(metrics[0].estimatedHours).toBe(0.08);
    });
});
