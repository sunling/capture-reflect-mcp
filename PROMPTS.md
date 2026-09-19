# Capture & Reflect — Prompt Gallery

Five short, everyday prompts for each workflow. You can speak naturally; these are examples, not mandatory commands or guarantees of tool selection.

**Start here:** “Captain's log.” · “Note to self...” · “Review my week.” · “Break my bubble.”

| Workflow | Five prompts |
| --- | --- |
| Journal (`capture_journal`) | Captain's log. · Dear diary... · Journal for today. · Record my day: ... · Add to today's journal: ... |
| Note (`capture_note`) | Note to self... · Take a note. · Save this idea: ... · Capture this thought: ... · Save a note about AI: ... |
| Edit (`update_record`) | Add to that note: ... · Update my note on writing. · Fix that typo. · Correct this entry: ... · Add to yesterday's journal: ... |
| Search (`search_records`) | Find my notes on AI. · Have I written about burnout? · Search for writing. · When did I mention Sam? · Find my note on productivity. |
| Read (`get_records_by_date_range`) | Show my recent records. · What did I write yesterday? · Read my last seven days. · Show this week's journal. · Show last month's notes. |
| Connections (`get_record_connections`) | What links to this note? · Show this note's backlinks. · Show this record's links. · Check this note's broken links. · Map this note's connections. |
| Review (`review-records` workflow) | Review my week. · Give me a weekly recap. · Reflect on my week. · Review my month. · What patterns emerged this week? |
| Save review (`save_review`) | Save this review. · Save my weekly review. · Save our review to GitHub. · Keep this as a review. · Save the monthly review. |
| Bubble Breaker (`get_bubble_breaker_context`) | Break my bubble. · Find me something unfamiliar. · Bubble Breaker: surprise me. · Bubble Breaker: challenge my view. · I finished that Bubble Breaker resource. |
| Setup (`get_github_setup_link`) | Set up GitHub. · Connect my records repo. · Change my records repo. · Update my time zone. · Reconfigure my connection. |
| Switch account (`get_github_account_switch_link`) | Switch GitHub accounts. · Use another GitHub account. · Change my GitHub user. · Connect a different GitHub account. · Switch my connected account. |

## How to use these examples

- **Starters invite content:** “Captain's log.”, “Dear diary...”, and “Take a note.” without entry text should invite you to continue, not save an empty record. The ellipses mean *keep talking*.
- **Context matters:** Once you begin journaling, later fragments remain journal content unless you change direction. A direct question such as “How can I present my demo?” should be answered, not silently saved or routed to Bubble Breaker.
- **Targets matter:** Editing and graph lookup require identifying the exact record first. Today's ordinary journal continuation uses `capture_journal`; editing an identified older journal uses `update_record`.
- **Keep intentions distinct:** “Review my week” starts a review; “Save this review” saves one already prepared. Search, reading, graph lookup, and Bubble Breaker discovery are read-only.
- **Do not over-trigger:** “I learned something” alone is not a complete note. “Find me a new perspective” alone is not necessarily a Bubble Breaker request. Follow explicit intent and conversation context; clarify only when needed.

These prompts are also useful for manual routing evaluations in the connected client. Metadata tests alone cannot prove the AI will choose the intended tool.
