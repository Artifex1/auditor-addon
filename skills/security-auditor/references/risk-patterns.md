# Risk Patterns Reference

## Common Weakness Patterns
- **Happy Path Bias**: Scrutinize success paths and "obviously safe" branches, as they often bypass critical checks found in failure paths.
- **Binding Integrity**: Ensure cryptographic binding between Identity, Intent, and Parameters (signature/hash/registry).
- **Input Validation**: Treat all unvalidated inputs (e.g., negative amounts, non-canonical keys) as potential attack vectors.
- **Unit Consistency**: Verify consistency in unit conversions (bytes vs bits, decimal precision, token scalars).
- **State Machine Safety**: Ensure comprehensive failure handling; missing error paths can lead to locked funds or frozen state.
- **Uniqueness & Replay**: Verify global uniqueness of nonces and IDs to prevent replay attacks and collision.
- **Denial of Service (DoS)**: Identify unbounded loops and mandatory calls that can revert, enabling griefing or system halt.
- **Operational Binding**: Ensure governance execution is cryptographically bound to the specific proposal/request.
- **Cross-Domain Boundaries**: Validate assumptions at trust boundaries (cross-chain messages, inter-process calls).
- **Invariant Tracing**: Rigorously trace basic flows and state transitions against defined invariants, ignoring perceived simplicity.
- **Unenforced Safety Mechanisms**: Verify that safety-critical state (flags, circuit breakers, pause states) is read and enforced in the paths it should gate, not just written.
- **Override/Extension Mismatch**: When components extend, inherit, or wrap base behavior, verify that overrides preserve ALL security properties of the base — both explicit guards (require, revert, access control) AND implicit structural properties (storage key schemes, ordering assumptions, aggregation granularity).
- **Implicit Structural Guarantees**: Security properties enforced by data structure design (composite keys, ordering constraints, slot isolation) rather than explicit checks. These are invisible to grep-for-require analysis and are the first casualties of optimization refactors.
- **Protective Trap**: Safety mechanisms that block user actions (circuit breakers, slippage checks, withdrawal limits) can worsen the situation they aim to prevent. For each protective revert, ask: in the failure case it guards against, is the user better off with the action blocked or executed?

## High Severity Risk Patterns
- **Library Surface**: Treat helper libraries and internal functions as critical protocol surface area, not just utilities.
- **Boundary Authentication**: Enforce identity and access control strictly at external entry points.
- **Domain Separation**: Ensure all signatures include domain separation to prevent cross-context replay.
- **Cross-Chain Validation**: Explicitly validate message origin, source chain ID, and sequence indexing.
- **Precision & Rounding**: Analyze rounding direction and accumulation errors, treating them as potential economic exploits.
- **Gas Accounting**: Ensure all computation is bounded and gas-metered to prevent resource exhaustion.
- **Exception Handling**: Verify system recovery from partial failures in multi-step state transitions.
- **Upgrade Safety**: Secure initialization phases, storage layout compatibility, and feature flag consistency.
- **External Interaction**: Treat all external calls as adversarial; assume control flow transfer can lead to reentrancy.
- **Edge Case Analysis**: Investigate unique or "one-off" anomalies; do not dismiss outliers.
