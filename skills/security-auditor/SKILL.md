---
name: security-audit
description: Conducting interactive security audits of codebases. RECON builds a structural map with the aud CLI and establishes trust assumptions. SCAN spawns fresh isolated agents to reason about clusters and hypotheses — the auditor steers every round. SWEEP checks risk pattern coverage with fresh agents. Use when the user wants to audit code, find vulnerabilities, review security, scan for bugs, or analyze code for exploits. Triggers on "audit", "security review", "find vulnerabilities", "scan contracts", "check for bugs".
argument-hint: "<files or scope>"
effort: max
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Security Audit

**RECON** → **SCAN** (looped) → **SWEEP**. Every analysis spawns a fresh agent with isolated context. The main thread orchestrates, consolidates, and presents — it never reasons about whether code is safe or vulnerable. The auditor steers every round.

## CLI Binary

This skill requires the `auditor-addon-cli` skill for the `aud` binary. Before running any `aud` command, load that skill to determine the correct binary path.

## Scope

The user provides files, a file list, or a scope file. Use those exact files — do not broaden with globs unless the user explicitly asks for a broad scan.

```bash
# Correct — user's exact scope
aud gaps src/FileA.sol src/FileB.sol

# Wrong — pulls in out-of-scope files
aud gaps "src/**/*.sol"
```

## Architecture

```
Main thread (this skill)
│
├── Runs static tools (aud gaps, run, call-chains, peek, metrics)
├── Curates context for each agent
├── Consolidates agent outputs into audit documents
├── Presents results to auditor
├── Takes steering input
│
└── NEVER reasons about code safety or vulnerability
    All analysis happens in fresh agents ↓

Agent (spawned per task)
├── Receives: source code + call edges + signals + assumptions
├── Receives: specific task (scan cluster / investigate hypothesis / check pattern)
├── Does NOT receive: prior agents' reasoning chains or mental models
├── Returns: findings, refutations, backlog items, structural observations
└── Dies. Only factual outputs survive.
```

**Why:** Same-model confirmation bias. When an agent concludes "X is safe because Y," any subsequent analysis that inherits that reasoning is anchored to it — even if it's wrong. Fresh agents build their own understanding from source code, which means they can't inherit a wrong mental model.

**What crosses agent boundaries (factual only):**
- Confirmed finding: title + location + severity (one line)
- Refuted hypothesis: title + what prevents it (one line)
- Backlog item: hypothesis + why unresolved
- Structural observation: storage handoff points, interface mismatches
- Auditor answers and steering from checkpoints

**What NEVER crosses agent boundaries (analytical):**
- "What goes wrong" reasoning chains
- "Why this isn't prevented" analysis
- Mental models of how the code works
- "This is safe because..." explanations

---

## Persistence

Audit state is written to `audit/` so sessions can resume. Write at each checkpoint.

**Resuming:** If `audit/` exists, read all state before proceeding. Skip completed work, resume from earliest incomplete point.

**`audit/assumptions.md`** — after trust interview. Also updated when the auditor provides new context at any checkpoint:

```markdown
## Scope
- {file list}

## Accepted
- {function} in {Component} — {what it does, why accepted}

## Constrained
- {function} — {accepted, must be bounded: range/timelock}

## Examine
- {function} — {why questionable}

## External Dependencies
- {System} — trusted / examine boundary

## Design Decisions
- {Tradeoff} — intentional / examine
```

**`audit/backlog.md`** — living document, updated every round:

```markdown
## Queue
- [ ] [cluster] {Cluster name} — {files} — {signal count}
- [ ] [hypothesis] {Specific question} — source: {where it came from}
- [ ] [lead] {Cross-cluster observation} — from scan of {cluster}
- [ ] [pattern] {Risk pattern} — uncovered in SWEEP

## Done
- [x] [cluster] {name} — {N findings, M refuted}
- [x] [hypothesis] {question} → confirmed F-{NNN} / refuted / inconclusive
```

**`audit/findings.md`** — consolidated one-line summaries only:

```markdown
## Confirmed
- F-001: {Title} — {severity} — {file:line}
- F-002: {Title} — {severity} — {file:line}

## Refuted
- R-001: {Hypothesis} — prevented by {what, where}

## Suspicions
- S-001: {Description} — {why unresolved}
```

**`audit/findings/{id}.md`** — full finding detail per confirmed issue.

---

## Threat Model

Baseline assumptions (override with protocol-specific answers from the RECON interview):

- Privileged roles (owner, admin, operator) are **honest and competent**.
- Discard any finding that requires a privileged role to act maliciously.
- Focus on unprivileged actors, bad interactions between honest components, and edge cases in normal operation.

Protocol-specific trust assumptions are established during RECON and recorded in `audit/assumptions.md`. Every agent receives this document. Findings that contradict confirmed assumptions are suppressed.

---

## Phase 1: RECON

**Goal:** Build a structural map using static tools. Establish trust assumptions. Populate the initial backlog. Zero model reasoning about vulnerabilities.

**Steps — run all, batch where possible:**

1. **SAiST pipeline:** Spawn an agent to run the `sast-pipeline` skill against the scope files. The agent handles the full gaps → resolve → run-rules flow in a clean context and returns:
   - The `resolutions.csv` path (if gaps existed and were resolved)
   - All rule findings with kind tags (`issue`, `smell`, `pointer`)
   - Any high-priority gaps that could not be resolved

   Agent prompt template:
   ```
   Load the `auditor-addon-cli` skill first to locate the `aud` binary,
   then run the `sast-pipeline` skill against these files: {scope files}

   Execute the full pipeline: gaps → resolve → run rules.
   Write resolutions to `audit/resolutions.csv`.
   Resolution targets may point to files outside the original scope —
   that is expected; `aud` parses them into the graph automatically.

   Resolve as many gaps as you can — all high-priority, medium if they
   touch public entry points. After each batch of resolutions, re-run
   `aud gaps <scope files> --resolutions=audit/resolutions.csv` to
   confirm progress and see what remains. Iterate until only
   low-priority or genuinely unresolvable gaps remain.

   After completion, report back:
   1. The resolutions CSV path (or "no gaps" if clean)
   2. Remaining unresolved gaps (with priority and why unresolvable)
   3. All rule findings (full output)
   ```

   Pass the resolutions CSV to subsequent `aud` commands in this phase.

2. **Call chains:** `aud call-chains <scope files> --resolutions=audit/resolutions.csv` — extract the cross-file interaction graph with resolved edges.
3. **Structural summary:** `aud peek <scope files>` and `aud metrics <scope files>` — interface surfaces and complexity signals.

**Build interaction clusters** from call-chain output:
- Group files that call each other (directly or transitively) into clusters.
- A file may appear in multiple clusters if it bridges groups.
- Rank by: cross-file edges × complexity.
- Within each cluster, note **interface mismatches**: functions that one component calls on another but the target does not expose (visible from gaps + call-chains).

**Build signal list** — ranked:
- Rule findings (issue > smell > pointer)
- Interface mismatches
- Unresolved high-priority gaps
- Complexity outliers

**Present Part 1 — structural map:**

```
## RECON Summary

### Clusters (ranked)
1. {Name} — {files} — {N edges, M signals}
2. ...

### Standards / Specs
- {Any standards the code implements or depends on}

### Static Signals ({N total})
- [issue] {RULE-ID}: {file:line — description}
- [smell] {RULE-ID}: {file:line — description}
- [mismatch] {A calls foo() on B — B does not expose it}
- [pointer] {RULE-ID}: {file:line — description}
```

**Present Part 2 — trust & assumptions interview:**

Generate questions from what you **observed in the code**, not from a template.

Scan `aud peek` output for every privileged operation, external dependency, and design tradeoff. Ask:

```
## Trust & Assumptions Interview

### Privileged Operations
1. `{function}` in {Component} — {what it does}.
   → Accepted / Constrained / Examine?

### External Dependencies
2. {System} — {how it's used}.
   → Trusted black box / Examine boundary?

### Design Decisions
3. {Observable tradeoff}.
   → Intentional / Examine?
```

**Checkpoint:** STOP. Wait for answers. Write `audit/assumptions.md`. Any "Examine" items become hypothesis entries in the backlog.

**Populate initial backlog:** Add each cluster as a `[cluster]` item. Add "Examine" items as `[hypothesis]` items. Write `audit/backlog.md`.

Ask the auditor: **"Which cluster do you want to start with?"**

---

## Phase 2: SCAN

**Goal:** Analyze code through fresh agents. The auditor controls the loop.

SCAN is a loop. Each round:
1. Auditor picks a task from the backlog (cluster, hypothesis, lead, or free-form question)
2. Main thread assembles context and spawns a fresh agent
3. Agent returns results
4. Main thread consolidates into audit documents
5. Present to auditor for triage
6. Auditor decides what's next

### Spawning a SCAN agent

**Every SCAN agent is a background high-effort agent.** The agent builds its own understanding of the code from scratch.

**Context assembly — the main thread prepares:**
- File paths for every file in the target cluster (agents read them directly)
- Call-chain edges between files
- Rule findings and interface mismatches touching the cluster
- `audit/assumptions.md` (full document)
- `audit/findings.md` (one-line summaries only — NO reasoning chains, NO full finding details)
- The specific task

**If a cluster exceeds context limits:** Split along weakest internal edges. Use `aud peek` summaries for peripheral files, full source for core files.

**Agent types** — load the appropriate agent file and fill its placeholders with assembled context:

- **Cluster scan:** `agents/cluster-scan.md` — free-form analysis of a cluster
- **Hypothesis:** `agents/hypothesis.md` — targeted investigation of a falsifiable question
- **Trace:** `agents/trace.md` — mechanical value tracing through a storage handoff point (receives NO SCAN findings or reasoning — only writer/reader source and concrete inputs)

### After each agent returns

1. **Extract factual outputs:** findings, refutations, backlog items, observations.
2. **Update audit documents:**
   - New findings → `audit/findings.md` (one-line) + `audit/findings/{id}.md` (full detail)
   - Refuted items → refuted section of `audit/findings.md`
   - New backlog items → `audit/backlog.md`
   - Mark completed items done in backlog
   - If the auditor provides new context or corrections → update `audit/assumptions.md`
3. **Present to auditor:**

```
## Round {N} Results — {task description}

### New Findings
- F-{NNN}: {title} — {severity}

### Refuted
- {What was checked and why it's safe}

### New Backlog Items
- {Hypotheses the agent couldn't resolve}

### Current Backlog ({N items remaining})
- {Top items by priority}
```

4. **Auditor decides next action:**
   - "Scan cluster X" → spawn cluster-scan agent
   - "Investigate {hypothesis}" → spawn hypothesis agent
   - "Investigate these 5 in parallel" → spawn multiple hypothesis agents
   - "Trace {handoff point} with {values}" → spawn trace agent (no SCAN context)
   - "Go deeper on finding F-{NNN}" → spawn focused follow-up agent
   - "I think {X} might be an issue" → add to backlog or spawn immediately
   - "Move to SWEEP" → exit SCAN loop
   - "Done" → wrap up

---

## Phase 3: SWEEP

**Goal:** Coverage safety net. Fresh agents check risk patterns against the code — not against prior SCAN reasoning.

**Steps:**

1. Load `references/risk-patterns.md`.
2. Check `audit/findings.md` and `audit/backlog.md`: which risk patterns have NO corresponding finding, refutation, or backlog entry?
3. For each uncovered pattern, present to auditor:

```
## Uncovered Risk Patterns

These patterns were not addressed in any SCAN round:

1. {Pattern name} — relevant to: {components}
2. {Pattern name} — relevant to: {components}
3. ...

### Standards Checklists
- {Standard identified in RECON} — spawn checklister? (Y/N)

Which patterns should I investigate?
```

4. **For each selected pattern**, spawn a fresh agent using `agents/sweep-pattern.md`. Fill placeholders with the pattern description, relevant source files, assumptions, and known findings.

5. **Standards conformance:** If the auditor wants checklist coverage, spawn `checklister` agent for identified standards. Critical/high checklist items not already covered become new backlog entries. The auditor can run additional SCAN rounds for those (back to Phase 2 if needed).

**Custom rule flywheel:**
For any confirmed finding that represents a repeatable structural pattern:
1. Recognize: could this appear elsewhere or in future engagements?
2. Write a rule: `./rules/CUSTOM-NNN-<name>.lua` (use `rule-authoring` skill)
3. Test against the known instance
4. Run against full scope: `aud run <scope files> --rule-path=./rules/CUSTOM-NNN-<name>.lua`
5. New hits → back to SCAN as hypotheses

---

## References

**Agents** (`agents/`):
- `cluster-scan.md`: Free-form cluster analysis. Spawned during SCAN.
- `hypothesis.md`: Targeted hypothesis investigation. Spawned during SCAN.
- `trace.md`: Mechanical value tracing through storage handoffs. Spawned during SCAN. Receives no SCAN context.
- `sweep-pattern.md`: Risk pattern coverage check. Spawned during SWEEP.
- `checklister.md`: Standards research. Spawned during SWEEP for identified standards.

**References:**
- `references/finding-format.md`: Finding and refutation templates. Agents read this for output format.
- `references/risk-patterns.md`: Loaded during SWEEP only.

**Skills:**
- `sast-pipeline`: SAiST pipeline, spawned during RECON.
- `rule-authoring`: Writing custom detection rules.

---

## Principles

- **Context before reasoning.** The right files in the context window matters more than reasoning depth. Use `aud` tools to build context; agents reason about it.
- **Fresh eyes on every task.** Every analytical act gets a fresh agent. No reasoning chains cross agent boundaries. Only factual outputs survive.
- **Absence is a finding.** A function NOT exposed, a check NOT present, a path that does NOT exist. Look for what is missing, not just what is wrong.
- **Cross-file by default.** Never analyze a component in isolation. Clusters ensure related files are always co-present.
- **Ask, don't guess.** Unresolvable assumptions go to the auditor, not into a guess.
- **Negative results have value.** "Investigated X, safe because Y" builds the audit record.
- **Refute before confirming.** Argue the opposite. If you can't kill it, it's a finding.
- **Static tools do static work.** `aud` for structure, agents for semantics.
