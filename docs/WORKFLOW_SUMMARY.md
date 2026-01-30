# Workflow Summary - Quick Reference Guide

This document provides a quick reference for the development workflow used in this project. For detailed explanations, see `CURSOR_WORKFLOW.md`.

## Overview

This project uses a **documentation-driven, vertical slice workflow** with Cursor AI Agents. The workflow centers around pinned documentation files that serve as the source of truth, allowing ephemeral AI agents to work effectively without relying on chat history.

## Two Workflow Styles

### Style 1: Technical Lead (You = Architect + Reviewer)

**Your Role:**
- Make architectural decisions
- Review AI-generated code
- Update documentation when patterns change
- Own `docs/spec.md` and `docs/schema.md`

**AI's Role:**
- Implement exactly what you specify
- Follow your architectural decisions
- No autonomous decision-making

**Best For:**
- Complex/new features requiring careful architecture
- When you want full control over technical decisions
- Learning from the codebase

### Style 2: Product Manager (You = Ideas + Testing)

**Your Role:**
- Define what to build (tickets)
- Test the final result
- Give feedback/direction
- **You don't code or review architecture**

**AI's Role:**
- Architect: Makes technical decisions
- Implementer: Writes all code
- Reviewer: Self-reviews and fixes issues

**Best For:**
- Moving fast
- Non-technical users
- When you trust AI to make good technical decisions
- Focused on product direction, not implementation

## Core Workflow Process

### Step 1: Pin Documentation Files

**Always Pin:**
- `docs/spec.md` - Project specification and current features
- `docs/backlog.md` - Current tickets and features

**Pin When Relevant:**
- `docs/schema.md` - When working on data layer
- `docs/api.md` - When working on services

**How to Pin:**
- Right-click file → "Pin" or use pin icon in file tab

### Step 2: Create/Select Ticket

**Ticket Location:** `docs/backlog.md`

**Ticket Format:**
```markdown
#### Ticket: [Feature Name]
**Goal**: [What user can do]
**DB**: [Table changes, if any]
**UI**: [Page/component description]
**Acceptance**:
- [ ] Criterion 1
- [ ] Criterion 2
```

**Ticket Requirements:**
- Complete vertical slice (UI + data + logic)
- Clear acceptance criteria
- Specific enough for AI to implement

### Step 3: Launch AI Agent

**Open Agent:** Cmd+L (Mac) or Ctrl+L (Windows)

**For Product Manager Style** (Recommended):
```
You are acting as Architect, Implementer, and Reviewer for this ticket.

Read docs/spec.md, docs/schema.md, docs/api.md, and docs/backlog.md.

We are implementing ticket: [TICKET_NAME]

**Your Responsibilities:**
1. **Architect**: 
   - Review existing patterns in the codebase
   - Decide on implementation approach
   - Update docs/schema.md if database changes needed
   - Update docs/api.md if API changes needed
   - Ensure consistency with existing code style

2. **Implementer**:
   - Write all necessary code
   - Follow existing patterns (see components/, services/)
   - Add proper TypeScript types
   - Handle edge cases and errors

3. **Reviewer**:
   - Self-review your implementation
   - Check for edge cases, error handling, code quality
   - Fix any issues you find
   - Ensure all acceptance criteria are met

**Output Format:**
1. Architecture decisions made
2. Summary of implementation
3. Files changed (with brief explanation of each)
4. Any docs updated (spec.md, schema.md, api.md)
5. Manual test steps
6. Self-review findings and fixes

**Important**: 
- Do NOT ask for approval on architectural decisions - make them yourself
- Do NOT skip the review step - find and fix issues before presenting
- Update docs proactively if patterns change
```

**For Technical Lead Style:**
```
Read docs/spec.md, docs/schema.md, and docs/backlog.md. 

We are implementing ticket: [TICKET_NAME]

Do not change RLS model or table shapes unless you update docs/schema.md and justify the change.

Output format:
1. Summary of changes
2. Files changed
3. SQL migrations (if any)
4. Manual test steps
```

### Step 4: Review & Test

**Review Changes:**
- Check files changed in Composer
- Verify no unintended changes
- Ensure code quality

**Test:**
- Follow manual test steps from AI
- Try edge cases
- Verify acceptance criteria

### Step 5: Mark Complete

**Update `docs/backlog.md`:**
```markdown
### ✅ Completed
- [Feature Name] (YYYY-MM-DD) - Brief description
```

**Update Other Docs (if needed):**
- `docs/spec.md` - Add new features to "Current Features"
- `docs/schema.md` - Document schema changes
- `docs/api.md` - Document API changes

## Key Documentation Files

| File | Purpose | When to Pin |
|------|---------|-------------|
| `docs/spec.md` | Project specification, current features, tech stack | Always |
| `docs/backlog.md` | Tickets and features to implement | Always |
| `docs/schema.md` | Data schema (TypeScript types, Firebase schema) | When working on data layer |
| `docs/api.md` | Service layer documentation | When working on services |
| `docs/CURSOR_WORKFLOW.md` | Detailed workflow guide | Reference only |
| `docs/PRODUCT_MANAGER_PROMPT.md` | Template prompt for Product Manager style | Reference only |
| Carrier-specific docs | Extraction logic for each carrier | When working on carrier processing |

## Project Structure

```
/
├── docs/              # Documentation (source of truth)
├── components/        # React components
├── services/          # API/service layer
├── firestore/         # Firebase configuration (rules, indexes)
├── types.ts           # TypeScript types
└── ...
```

## Current Project State

### Tech Stack
- **Frontend**: React 19 + Vite + TypeScript
- **Backend**: Firebase (Firestore + Cloud Storage)
- **AI**: Google Gemini 2.5 Flash
- **UI**: Tailwind CSS, Lucide React icons, Recharts

### Key Features
- ✅ Master Data Management (account-level view with expandable details)
- ✅ Carrier Statement Processing (6 carriers: Zayo, GoTo, Lumen, MetTel, TBO, Allstream)
- ✅ Matching Against Master Data
- ✅ Dispute Detection (6 types)
- ✅ Seller Statement Generation
- ✅ Firebase Backend Integration (complete)

### Current Status
- Backend: Fully migrated to Firebase
- See `docs/backlog.md` for current tickets

## Common Patterns

### Adding a New Component
1. Create component in `components/`
2. Follow existing patterns (Layout, styling)
3. Add route in `App.tsx` (if needed)

### Adding a New Service
1. Create service in `services/`
2. Follow `geminiService.ts` patterns
3. Update `docs/api.md` if needed

### Database Changes
1. Update `firestore/firestore.rules` (if security rules change)
2. Update `firestore/firestore.indexes.json` (if indexes change)
3. Update `docs/schema.md`
4. Update TypeScript types in `types.ts`
5. Deploy changes: `npx firebase-tools deploy --only firestore`

## Tips & Best Practices

### Managing Context
- **Problem**: Agents lose context between sessions
- **Solution**: Always pin docs, start each agent with prompt template
- **Key Point**: Docs are source of truth, not chat history

### Using Composer vs Agent Chat
- **Use Composer** (this interface) when:
  - Making changes yourself
  - Reviewing agent output
  - Making small fixes
  
- **Use Agent Chat** when:
  - Implementing a full ticket
  - Want AI to generate code
  - Need AI to read and understand docs

### Error Handling
- **If Agent Makes Mistakes**: Don't accept changes, explain what went wrong, ask agent to fix it
- **If Agent Changes Wrong Files**: Reject changes, point agent to correct files, use file paths in prompts
- **If Agent Creates Wrong Structure**: Point to existing examples, show correct pattern

## Quick Start Checklist

Starting a new ticket? Follow these steps:

- [ ] Read ticket in `docs/backlog.md`
- [ ] Pin `docs/spec.md` and `docs/backlog.md`
- [ ] Pin `docs/schema.md` (if data changes)
- [ ] Pin `docs/api.md` (if service changes)
- [ ] Open Agent (Cmd+L)
- [ ] Paste Product Manager prompt (or Technical Lead prompt)
- [ ] Replace `[TICKET_NAME]` with actual ticket name
- [ ] Let agent work
- [ ] Review changes in Composer
- [ ] Test using agent's test steps
- [ ] Mark ticket complete in `docs/backlog.md`
- [ ] Update other docs if needed

## Example: Full Product Manager Flow

```
You: [Creates ticket] "Users need to filter reports by date range"

You: [Pins docs, opens agent, pastes Product Manager prompt with ticket name]

Agent: 
  → Reads docs
  → Sees existing Reports component uses Recharts
  → Decides: Add date range picker, filter button, update table
  → Implements: DateRangePicker component, filter logic, UI updates
  → Reviews: Checks for empty data, invalid dates, edge cases
  → Updates: spec.md with new feature
  → Presents: "Added date filtering to Reports component..."

You: [Tests] "Looks good! But can we show it by salesperson too?"

Agent: [Fixes] Adds salesperson filter

You: [Tests] "Perfect!" [Marks complete]
```

## Troubleshooting

**Agent doesn't read docs:**
- Make sure docs are pinned
- Explicitly mention file paths in prompt
- Use absolute paths if needed

**Agent changes wrong things:**
- Be more specific in prompt
- List files that should NOT change
- Review before accepting

**Agent creates wrong structure:**
- Point to existing examples
- Show correct pattern
- Ask agent to follow existing code style

## Next Steps

1. **Choose your workflow style** (Technical Lead or Product Manager)
2. **Start with a simple ticket** to practice the workflow
3. **Refine your prompts** based on results
4. **Scale up** to more complex tickets

## Remember

- **Docs are your source of truth** - keep them updated
- **Agents are ephemeral workers** - context comes from pinned docs
- **You are the architect** (Technical Lead) or **product owner** (Product Manager)
- **Test thoroughly** - AI makes mistakes
- **Give feedback** - if something's wrong, tell the agent and let it fix it

---

For detailed explanations, see `docs/CURSOR_WORKFLOW.md`.
For Product Manager prompt template, see `docs/PRODUCT_MANAGER_PROMPT.md`.
