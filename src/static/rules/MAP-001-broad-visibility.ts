import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolGraph } from "../../engine/types.js";

/**
 * MAP-001: Broad Visibility
 *
 * For `public` functions: if no caller is from a different contract/module,
 * the function could use a tighter visibility (external).
 * Skips virtual/override functions (legitimate polymorphism).
 *
 * For `internal` functions: if all callers share the same contract,
 * the function could be private.
 *
 * Requires languages where adapters populate `container` + `visibility`.
 */
function createRule(): MapRule {
    return {
        id: 'MAP-001',
        severity: 'info',
        title: 'Function visibility could be tighter',
        description: 'Functions with broader visibility than needed (public when only called internally, internal when only called from same contract) increase attack surface.',
        kind: 'smell',
        appliesTo: {
            languages: [
                SupportedLanguage.Solidity,
                SupportedLanguage.Cairo,
                SupportedLanguage.Move,
                SupportedLanguage.Rust,
                SupportedLanguage.Java,
                SupportedLanguage.Cpp,
            ],
        },

        check(graph: SymbolGraph, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];

            const nodeContainer = graph.getContainerOf.bind(graph);

            for (const node of graph.nodes()) {
                if (node.kind !== 'function') continue;
                if (node.status !== 'concrete') continue;

                // Skip virtual/override — check has_modifier edges
                const hasModifierEdges = graph.getOutEdgesOfKind(node.id, 'has_modifier');
                const hasVirtualOrOverride = hasModifierEdges.some(e => {
                    const modNode = graph.getNode(e.to);
                    return modNode && (modNode.label === 'virtual' || modNode.label === 'override');
                });
                if (hasVirtualOrOverride) continue;

                // Skip constructors, fallback, receive
                if (['constructor', 'fallback', 'receive'].includes(node.label)) continue;

                // Use graph edges for caller lookup
                const callEdges = graph.getInEdgesOfKind(node.id, 'calls');
                const file = node.locator?.file ?? '';
                const line = node.locator?.line ?? 0;
                const col = node.locator?.column ?? 0;

                // Resolve node's container via graph edge
                const nodeContainerNode = nodeContainer(node.id);

                if (node.visibility === 'public') {
                    // Check if any caller is from a different container
                    const hasCrossModuleCaller = callEdges.some(e => {
                        const callerContainerNode = nodeContainer(e.from);
                        return callerContainerNode?.id !== nodeContainerNode?.id;
                    });

                    if (!hasCrossModuleCaller) {
                        findings.push({
                            location: { file, line, col },
                            snippet: `${node.qualifiedName}: public with no cross-module callers — could be external or tighter`,
                        });
                    }
                } else if (node.visibility === 'internal') {
                    if (callEdges.length === 0) continue;
                    // All callers same container?
                    const allSameContainer = nodeContainerNode && callEdges.every(e => {
                        const callerContainerNode = nodeContainer(e.from);
                        return callerContainerNode?.id === nodeContainerNode.id;
                    });
                    if (allSameContainer) {
                        findings.push({
                            location: { file, line, col },
                            snippet: `${node.qualifiedName}: internal but only called within ${nodeContainerNode.label} — could be private`,
                        });
                    }
                }
            }

            return findings;
        },
    };
}

export default createRule();
