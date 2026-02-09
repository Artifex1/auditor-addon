---
name: threat-modeling
description: Analyzes smart contract codebases to identify potential threats. Generates a Threat Modeling report in the root of the codebase.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
---

# Threat Modeling

Systematically identify all **potential threats** in a smart contract codebase.

## 1. Analyze the Codebase

Take your time to analyze and understand the codebase. Gather all the context that any team member working on or around this codebase would have, including developers, system architects, and business stakeholders.

## 2. Generate an Architectural Diagram

Generate a Mermaid architectural diagram to be included in the output replacing the <architectural_diagram> in the structure template. Do not get into details, identify the following components
 - Components: smart contracts, do not display inheritances emulate as if the system would be deployed on-chain.
 - Business core functionalities: the most important functions of a smart contract that are used in the main business and data flows.
 - Roles: all users participating in the system with various rights (governance, owner, user, team member, etc.).

Keep it simple.

## 3. Determine Potential Attackers

Think about possible attack vectors and threats.
  - Where can they come from? 
  - From which side can the component be attacked?
  - What roles are there in the system?
  - Who potentially might not want you to succeed?
  - Which role do most people have access to?

The shorthand term might be to consider everyone as threat agents. Any privileged account that can be compromised impose security risks, and we don’t estimate the probability of it yet.

## 4. Identify Potential Assets That an Attacker May Want to Compromise

  - Steal users’ funds?
  - Make the project unavailable?
  - Read some secret data?
  - Harm the reputation of the project?
  - What from the project has value in the market?
  - What’s the worst that could happen to the project?
  - In what case the project or/and the users are going to lose money?

Determine the key assets of the protect.

## 5. Identify How Attackers Can Compromise the Assets

It’s time to play the hacker and think about how you would try to achieve the goals set in the previous point.
  - Which functions handle token transfer?
  - Do we check who is calling the functions?
  - What if the component we integrate with starts sending incorrect data?
  - Are we sure about the arithmetic operation result?
  - What if the user has a significant amount of tokens?
  - Can I call functions in a different order than expected?
  - What if the private key of one of the team members is compromised?

Make this brainstorm on every component and every function and add it to attack trees. Do not check whether these possible threats are real and reflected in the code. In the worst case, you’ll expand your database of known security threats.

## 6. Generate a Report Following the Output Format

Use the Output Format to generate a easy readable threat modeling of the codebase.

## Output Format
 
Generate and save in the root of the codebase a markdown report named `threat-modeling.md` with this structure:
```markdown
# Threat Modeling

## Architectural Diagram

<architectural_diagram>

---

## Roles

### Administrative Roles

| Role | Privileges | Risk Level |
|------|------------|------------|
| **Admin** | Upgrade implementations, list markets, set collateral factors, modify protocol parameters | Critical |

### User Roles

| Role | Actions | Risk Exposure |
|------|---------|---------------|
| **Supplier** | Deposit assets, earn interest, redeem cTokens | Loss of funds if protocol is compromised |
| **Borrower** | Borrow against collateral, repay loans | Liquidation risk if undercollateralized |

---

## Assets

| Asset | Description | Trust Levels |
|------|---------|---------------|
| **Asset1** | Super important asset  |  The level of access required to gain the asset control |

--- 

## Security Threats Categorization

### 1. Category 1

| Threat | Description | Affected Components | Priority |
| **Whitelist Bypass** | Circumventing whitelist restrictions | WhitelistAccess, CToken | HIGH |

## Recommendations

```

## Analysis Guidelines

1. **Be thorough**: Don't skip files. Every file that is a smart contract in the codebase matters.
2. **Be conservative**: When uncertain about a specific threat author, flag for review rather than miscategorize.
3. **Think like a security researcher**: Use security researcher experience to identify potential threats.
4. **Think like a developer**: Use codebase developer experience to identify potential threats.
5. **Think like an architect**: Use system architect knowledge to identify potential threats.
6. **Think like a business people**: Use business specific knowledge to identify potential threats.

