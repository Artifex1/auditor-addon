import crypto from "crypto";
import {
    SymbolMap, SymbolEntry, CallTargetKind,
    GapType, GapPriority
} from "../engine/types.js";

export interface SymbolGap {
    id: string;
    type: GapType;
    qualifiedName: string;
    callSite: { file: string; line: number; col: number };
    codeSnippet: string;
    relevantFiles: string[];
    priority: GapPriority;
}

function gapId(qualifiedName: string, file: string, line: number, col: number): string {
    const raw = `${qualifiedName}:${file}:${line}:${col}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function gapTypeFromTargetKind(
    targetKind: CallTargetKind,
    existsInMap: boolean
): GapType {
    if (targetKind === 'external_unknown') return 'unresolved_callee';
    if (targetKind === 'interface_dispatch') return 'interface_impl';
    if (!existsInMap) return 'external_library';
    return 'unresolved_callee';
}

/**
 * Detects gaps in a SymbolMap — callees that cannot be fully resolved.
 * A gap is emitted when:
 *  - targetKind is 'external_unknown' or 'interface_dispatch'
 *  - The callee does not exist in the SymbolMap (out-of-scope code)
 *
 * @param symbolMap - The symbol map to analyze
 * @param hotspots - Hotspot qualified names (used for priority assignment)
 * @param sourceFiles - Optional map of file path → content (for code snippets)
 */
export function detectGaps(
    symbolMap: SymbolMap,
    hotspots: string[] = [],
    sourceFiles?: Map<string, string>
): SymbolGap[] {
    const gaps: SymbolGap[] = [];
    const hotspotSet = new Set(hotspots.map(h => h.split(':')[0]));

    for (const [callerId, caller] of symbolMap) {
        for (const callee of caller.callees) {
            const existsInMap = symbolMap.has(callee.qualifiedName);
            const isGap =
                callee.targetKind === 'external_unknown'
                || callee.targetKind === 'interface_dispatch'
                || !existsInMap;

            if (!isGap) continue;

            const relevantFiles = new Set<string>();
            relevantFiles.add(caller.file);
            const target = symbolMap.get(callee.qualifiedName);
            if (target) relevantFiles.add(target.file);

            const priority = classifyGapPriority(caller, hotspotSet, callerId);
            const type = gapTypeFromTargetKind(callee.targetKind, existsInMap);

            const snippet = extractSnippet(caller, sourceFiles);

            gaps.push({
                id: gapId(callee.qualifiedName, caller.file, caller.line, caller.range?.start.column ?? 0),
                type,
                qualifiedName: callee.qualifiedName,
                callSite: {
                    file: caller.file,
                    line: caller.line,
                    col: caller.range?.start.column ?? 0,
                },
                codeSnippet: snippet,
                relevantFiles: [...relevantFiles],
                priority,
            });
        }
    }

    return gaps;
}

function classifyGapPriority(
    caller: SymbolEntry,
    hotspotSet: Set<string>,
    callerId: string
): GapPriority {
    if (hotspotSet.has(callerId)) return 'high';
    if (caller.isPublic) return 'medium';
    return 'low';
}

function extractSnippet(
    caller: SymbolEntry,
    sourceFiles?: Map<string, string>
): string {
    if (!sourceFiles) return '';
    const source = sourceFiles.get(caller.file);
    if (!source) return '';
    const lines = source.split('\n');
    const start = Math.max(0, caller.line - 3);
    const end = Math.min(lines.length, caller.line + 2);
    return lines.slice(start, end).join('\n');
}
