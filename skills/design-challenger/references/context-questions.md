# Context Questions

Use this checklist only when the prompt lacks key constraints. Ask the minimum needed.

- Users and stakeholders: Who depends on this design? What workflows break if it changes?
- Core requirements: What must remain true? (safety, liveness, correctness, compliance)
- Constraints: Latency, throughput, cost, tooling, backward compatibility, governance.
- Operational reality: Deployment cadence, on-call burden, upgrade windows, incident history.
- Failure modes: What happens when components fail or drift out of sync?
- Security assumptions: Trust boundaries, adversary model, blast radius limits.
- Extensibility needs: Are future feature changes expected or rare?
