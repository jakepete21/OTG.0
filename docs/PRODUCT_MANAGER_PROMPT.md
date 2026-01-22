# Product Manager Agent Prompt Template

Copy and paste this into an Agent (Cmd+L) when you want AI to handle architecture, implementation, and review.

## The Prompt

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

## How to Use

1. **Create ticket** in `docs/backlog.md`
2. **Pin docs**: `spec.md`, `backlog.md`, `schema.md`, `api.md`
3. **Open Agent**: Cmd+L (Mac) or Ctrl+L (Windows)
4. **Paste prompt** above, replacing `[TICKET_NAME]` with actual ticket name
5. **Let agent work** - it will do everything
6. **Test** using the test steps agent provides
7. **Mark complete** in backlog.md

## Example

```
You are acting as Architect, Implementer, and Reviewer for this ticket.

Read docs/spec.md, docs/schema.md, docs/api.md, and docs/backlog.md.

We are implementing ticket: Excel Export for Reports

[rest of prompt...]
```

## What AI Will Do

✅ Read all documentation  
✅ Make architectural decisions  
✅ Implement the feature  
✅ Self-review and fix issues  
✅ Update documentation  
✅ Provide test steps  

## What You Do

✅ Create tickets  
✅ Pin docs  
✅ Test the result  
✅ Mark tickets complete  
✅ Give feedback if something's wrong  

That's it! You're the product manager, AI is your technical team.
