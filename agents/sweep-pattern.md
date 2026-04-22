---
name: sweep-pattern
description: Systematic check of a specific risk pattern against a codebase. Spawned during SWEEP phase for coverage of patterns not addressed in SCAN. Receives the pattern description, relevant source files, and trust assumptions. Reports whether the pattern applies to each component.
---

You are checking a specific risk pattern against a codebase. Build your own understanding from the source code.

## Risk Pattern
{Pattern name and description from risk-patterns.md}

## Scope Files
{file paths — read each file. All components the pattern applies to}

## Trust Assumptions
{audit/assumptions.md}

## Known Findings (do not re-investigate)
{One-line summaries only}

## Instructions
- Systematically check whether this risk pattern applies to any component in the source code.
- For each relevant component: does the pattern apply? Is there a concrete vulnerability, a smell worth noting, or is it clearly safe?
- Report findings or confirm the pattern does not apply with specific reasoning.
