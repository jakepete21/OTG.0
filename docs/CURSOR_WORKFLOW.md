# How to Use Cursor Agents with This Workflow

This guide explains how to effectively use Cursor's UI and agents to implement the vertical slice workflow.

## Key Cursor Features You'll Use

### 1. **Pinned Files** (Critical for Context)
- **What**: Pin important documentation files so they're always visible
- **How**: Right-click on file → "Pin" or use the pin icon in the file tab
- **What to Pin**: 
  - `docs/spec.md` (always)
  - `docs/backlog.md` (always)
  - `docs/schema.md` (when working on data layer)
  - `docs/api.md` (when working on services)

### 2. **Agents** (Ephemeral Workers)
- **What**: AI assistants that can read files, make changes, and run commands
- **How**: Use Cmd+L (Mac) or Ctrl+L (Windows) to open agent chat
- **Key Point**: Agents are short-lived. Context comes from pinned docs, not chat history.

### 3. **Composer** (This Interface)
- **What**: Multi-file editing with full codebase context
- **How**: Use for complex changes across multiple files
- **Best For**: Implementing complete vertical slices

## Two Workflow Styles

### Style 1: Technical Lead (You = Architect + Reviewer)
You make architectural decisions and review code. AI implements.

### Style 2: Product Manager (You = Ideas + Testing)
You define what to build and test it. AI handles architecture, implementation, and review.

**Choose the style that fits your role!** See sections below for each.

---

## Workflow Style 1: Technical Lead (Original)

## The Three Roles (Adapted for Cursor)

### A) Architect Thread (You, the Human)
**Your Job**:
- Own `docs/spec.md` and `docs/schema.md`
- Make architectural decisions
- Update docs when patterns change
- Review agent outputs

**How to Use Cursor**:
- Keep `docs/spec.md` and `docs/schema.md` pinned
- When making decisions, update the docs first
- Use Composer to review agent changes before accepting

### B) Implementer Agent (Ephemeral)
**Job**: Implement exactly one backlog ticket

**How to Use**:
1. Open a new agent chat (Cmd+L)
2. Start with this prompt template:

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

3. Let the agent work
4. Review changes in Composer
5. Test manually
6. Mark ticket complete in `docs/backlog.md`

**Example**:
```
Read docs/spec.md, docs/schema.md, and docs/backlog.md. 

We are implementing ticket: Analysis History

Do not change RLS model or table shapes unless you update docs/schema.md and justify the change.

Output format:
1. Summary of changes
2. Files changed
3. SQL migrations (if any)
4. Manual test steps
```

### C) Reviewer/QA Agent (Ephemeral)
**Job**: Try to break it, check edge cases, suggest improvements

**How to Use**:
1. After implementer finishes, open new agent
2. Prompt:

```
Review the implementation of ticket: [TICKET_NAME]

Focus on:
- Auth/RLS assumptions (if applicable)
- Edge cases
- Data leaks
- Missing validation
- Error handling

Suggest specific improvements.
```

## Step-by-Step Workflow

### Starting a New Ticket

1. **Read the Ticket**
   - Open `docs/backlog.md`
   - Find the ticket you want to implement
   - Understand acceptance criteria

2. **Pin Relevant Docs**
   - Pin `docs/spec.md` (always)
   - Pin `docs/backlog.md` (always)
   - Pin `docs/schema.md` (if ticket involves data)
   - Pin `docs/api.md` (if ticket involves services)

3. **Open Implementer Agent**
   - Cmd+L to open agent
   - Use the prompt template above
   - Let agent work

4. **Review Changes**
   - Agent will show files changed
   - Review in Composer before accepting
   - Check for:
     - Unintended changes
     - Missing pieces
     - Code quality

5. **Test**
   - Follow manual test steps from agent
   - Try edge cases
   - Verify acceptance criteria

6. **Update Docs**
   - If behavior changed: update `docs/spec.md`
   - If schema changed: update `docs/schema.md`
   - Mark ticket complete in `docs/backlog.md`

7. **Optional: QA Review**
   - Open Reviewer agent
   - Get feedback
   - Make improvements

### Finishing a Ticket

1. **Update Backlog**
   ```markdown
   ### ✅ Completed
   - Analysis History (2024-01-15) - Added history page, analysis storage
   ```

2. **Update Spec** (if needed)
   - Add new features to "Current Features"
   - Update workflows if changed

3. **Commit Changes**
   - Commit with clear message: "feat: implement analysis history"

4. **Start Next Ticket**
   - Pick next ticket from backlog
   - Repeat process

## Cursor-Specific Tips

### Using Composer vs Agent Chat

**Use Composer** (this interface) when:
- You want to make changes yourself
- You need to see full context
- You're reviewing agent output
- Making small fixes

**Use Agent Chat** when:
- Implementing a full ticket
- You want AI to generate code
- You need AI to read and understand docs
- You want AI to suggest approaches

### Managing Context

**Problem**: Agents lose context between sessions

**Solution**: 
- Always pin `docs/spec.md` and `docs/backlog.md`
- Start each agent with the prompt template
- Docs are the source of truth, not chat history

### File Organization

**Current Structure**:
```
/
├── docs/           # Documentation (source of truth)
├── components/     # React components
├── services/       # API/service layer
├── types.ts        # TypeScript types
└── ...
```

**Keep It Clean**:
- Don't let agents create random files
- Follow existing patterns
- Update docs when structure changes

### Error Handling

**If Agent Makes Mistakes**:
1. Don't accept changes
2. Explain what went wrong
3. Ask agent to fix it
4. Or fix manually in Composer

**If Agent Changes Wrong Files**:
1. Reject changes
2. Point agent to correct files
3. Use file paths in prompts

## Example: Implementing "Analysis History"

### Step 1: Setup
- Pin `docs/spec.md`, `docs/backlog.md`, `docs/schema.md`
- Read ticket in backlog

### Step 2: Agent Prompt
```
Read docs/spec.md, docs/schema.md, and docs/backlog.md. 

We are implementing ticket: Analysis History

Do not change RLS model or table shapes unless you update docs/schema.md and justify the change.

Output format:
1. Summary of changes
2. Files changed
3. SQL migrations (if any)
4. Manual test steps
```

### Step 3: Review Agent Output
- Check files changed
- Verify SQL migrations match schema.md
- Ensure UI follows existing patterns

### Step 4: Test
- Run manual test steps
- Try edge cases (empty history, many analyses, etc.)

### Step 5: Update Docs
- Mark ticket complete in backlog.md
- Update spec.md if workflows changed

### Step 6: Commit
```
git add .
git commit -m "feat: implement analysis history page"
```

## Common Patterns

### Adding a New Component
1. Agent creates component in `components/`
2. Follows existing patterns (Layout, styling)
3. Adds route in `App.tsx` (if needed)

### Adding a New Service
1. Agent creates service in `services/`
2. Follows `geminiService.ts` patterns
3. Updates `docs/api.md` if needed

### Database Changes
1. Agent creates migration SQL
2. Updates `docs/schema.md`
3. Updates TypeScript types in `types.ts`

## Troubleshooting

**Agent doesn't read docs**:
- Make sure docs are pinned
- Explicitly mention file paths in prompt
- Use absolute paths if needed

**Agent changes wrong things**:
- Be more specific in prompt
- List files that should NOT change
- Review before accepting

**Agent creates wrong structure**:
- Point to existing examples
- Show correct pattern
- Ask agent to follow existing code style

## Next Steps

1. **Start with a simple ticket** (e.g., "PDF Export")
2. **Practice the workflow** with one ticket
3. **Refine your prompts** based on results
4. **Scale up** to more complex tickets

Remember: The docs are your source of truth. Agents are ephemeral workers. You are the architect.

---

## Workflow Style 2: Product Manager (Hands-Off)

**Your Role**: Product Manager
- Define what to build (tickets)
- Test the final result
- Give direction/feedback
- **You don't code or review architecture**

**AI's Role**: Full Technical Team
- Architect: Makes technical decisions
- Implementer: Writes all code
- Reviewer: Self-reviews and fixes issues

### How It Works

#### Step 1: You Create a Ticket
Just write what you want in `docs/backlog.md`:

```markdown
#### Ticket: User Can Filter Reports by Date Range
**Goal**: Users can filter commission reports by date range

**UI**: 
- Date range picker in Reports tab
- Filter button
- Shows only transactions in selected range

**Acceptance**:
- [ ] Can select start and end date
- [ ] Filter button applies filter
- [ ] Table updates to show filtered results
- [ ] Can clear filter to show all
```

#### Step 2: Pin Docs and Launch Full-Stack Agent
Pin `docs/spec.md`, `docs/backlog.md`, `docs/schema.md`

Open Agent (Cmd+L) and use this **enhanced prompt**:

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
   - Check for:
     * Edge cases (empty data, invalid input, etc.)
     * Error handling
     * Code quality and consistency
     * Missing validation
     * Performance issues
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
- Do NOT ask for approval on architectural decisions - make them yourself based on existing patterns
- Do NOT skip the review step - find and fix issues before presenting
- Update docs proactively if patterns change
```

#### Step 3: Agent Does Everything
The agent will:
1. ✅ Read all docs
2. ✅ Make architectural decisions
3. ✅ Implement the feature
4. ✅ Self-review and fix issues
5. ✅ Update relevant docs
6. ✅ Present final result with test steps

#### Step 4: You Test
- Follow the test steps the agent provided
- Try edge cases
- If something's wrong, tell the agent: "The filter doesn't work when dates are reversed" and let it fix it

#### Step 5: Mark Complete
Update `docs/backlog.md`:
```markdown
- [x] Can select start and end date
- [x] Filter button applies filter
- [x] Table updates to show filtered results
- [x] Can clear filter to show all
```

Move ticket to "Completed" section.

### Product Manager Workflow Example

**You**: "I want users to be able to export reports as Excel files"

**You**: Add ticket to backlog.md:
```markdown
#### Ticket: Excel Export for Reports
**Goal**: Export commission reports as Excel (.xlsx)

**UI**: Export Excel button next to Export PDF button

**Acceptance**:
- [ ] Button downloads .xlsx file
- [ ] File includes all transactions
- [ ] File includes totals row
- [ ] File opens correctly in Excel
```

**You**: Pin docs, open agent, paste enhanced prompt with ticket name

**Agent**: 
- Reads codebase, sees PDF export uses jsPDF
- Decides to use xlsx library (already installed)
- Implements Excel export function
- Self-reviews: checks file format, error handling
- Updates docs/api.md with new function
- Presents: "Created exportCommissionStatementExcel() function, added button, tested with sample data"

**You**: Test by clicking button, verify Excel opens correctly

**You**: Mark complete ✅

### Key Differences: Product Manager Style

| Aspect | Technical Lead | Product Manager |
|--------|---------------|-----------------|
| **You** | Architect + Reviewer | Ideas + Testing |
| **AI** | Implementer only | Architect + Implementer + Reviewer |
| **Prompt** | Basic template | Enhanced "full-stack" prompt |
| **Your Work** | Review code, make decisions | Test, give feedback |
| **AI Autonomy** | Low (follows your decisions) | High (makes technical decisions) |

### When to Use Each Style

**Use Technical Lead** if:
- You want control over architecture
- You enjoy code review
- You're building something complex/new
- You want to learn from the codebase

**Use Product Manager** if:
- You're non-technical or prefer not to code
- You want to move fast
- You trust AI to make good technical decisions
- You're focused on product direction, not implementation

### Tips for Product Manager Style

1. **Make tickets detailed**: The more context in the ticket, the better AI decisions
2. **Trust but verify**: Test thoroughly - AI makes mistakes
3. **Give feedback**: If something's wrong, tell the agent and let it fix it
4. **Keep docs updated**: AI will update them, but review to ensure accuracy
5. **Start simple**: Begin with simple tickets to build trust in the workflow

### Example: Full Product Manager Flow

```
You: [Creates ticket] "Users need to see commission trends over time"

You: [Pins docs, opens agent, pastes enhanced prompt]

Agent: 
  → Reads docs
  → Sees existing charts use Recharts
  → Decides: Add line chart showing commission by month
  → Implements: New component, adds to Dashboard
  → Reviews: Checks for empty data, date formatting
  → Updates: spec.md with new feature
  → Presents: "Added CommissionTrendChart component..."

You: [Tests] "Looks good! But can we show it by salesperson too?"

Agent: [Fixes] Adds salesperson filter

You: [Tests] "Perfect!" [Marks complete]
```

Remember: In Product Manager style, you're the product owner. AI is your technical team.
