# Complexity Smells

Signals that a design may be overcomplicated at the system or protocol level.

- Multiple handoffs for a single operation without clear necessity.
- Invariants spread across many components instead of being localized.
- Configuration explosion: many knobs with unclear or overlapping purposes.
- Indirection layers that do not reduce coupling or add resilience.
- Workflow steps that must be coordinated manually or by fragile sequencing.
- Duplicate capabilities across modules with subtle differences.
- State split across services without a strong consistency model.
- Rarely used features that impose ongoing complexity or risk.
