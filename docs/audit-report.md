# AI Business Manager — Read-Only Repository Audit Report

Audit performed against the repository at the project root `D:\AI-Business-Manager`.
Only this file was created. No other repository files were modified, created, or deleted, and no database commands were run.

---

## 1. AGENTS.md

### Full content of AGENTS.md (866 lines, pasted verbatim)

````markdown
# AGENTS.md — AI Business Manager

## 1. PROJECT IDENTITY

Project name: AI Business Manager

This is a premium, easy-to-use, AI-powered Business Management System.

The application is designed for business owners, including users with very little technical knowledge.

The product is NOT just a chatbot.

The AI Business Manager must be able to:
- understand a user's business-related request
- inspect the user's business data
- reason over that data
- use controlled tools
- perform approved business actions
- verify the result
- explain the result clearly
- provide proactive business insights

The application must remain simple enough for non-technical users while still providing powerful agentic capabilities.

---

## 2. PROJECT ROOT — CRITICAL RULE

The existing project root is:

AI-Business-Manager/

ALL development MUST happen inside this existing project root.

### NEVER:
- create another project
- create a duplicate application
- create a second root folder
- create a phase-specific project
- create a separate frontend project
- create a separate backend project
- move the project into another folder
- recreate the project from scratch when continuing a phase

OpenCode must always work from the current project root.

Internal folders such as `app`, `components`, `lib`, `agents`, `tools`, `supabase`, `public`, etc. are allowed when required by the architecture.

The rule is: ONE APPLICATION, ONE PROJECT ROOT.

---

## 3. HOW TO WORK

Before making ANY changes:

1. Read this AGENTS.md completely.
2. Inspect the existing project structure.
3. Read relevant existing files.
4. Understand what has already been implemented.
5. Preserve working functionality.
6. Only then make the requested changes.

When a new prompt is provided:

- Continue from the current implementation.
- Do NOT restart the project.
- Do NOT recreate existing working features.
- Do NOT overwrite unrelated files.
- Do NOT make unrelated architectural changes.
- Do NOT remove previously approved features unless explicitly instructed.

Every implementation should be complete and production-minded.

Do not stop after creating placeholders when the requested feature can be fully implemented.

Do not leave unnecessary TODOs.

---

## 4. APPROVED TECHNOLOGY DIRECTION

Primary web stack:

- Next.js
- TypeScript
- React
- Tailwind CSS
- Framer Motion
- Supabase

Backend/data:

- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage when needed
- Supabase Row Level Security

AI:

- OpenAI Agents SDK for agent orchestration
- Gemini as the intended model provider using an available free tier
- Server-side AI execution
- Controlled server-side tools

Important:

Use the CURRENT supported OpenAI Agents SDK APIs and provider/custom-model integration available for the selected stack.

Do not invent unsupported SDK APIs.

Do not silently replace OpenAI Agents SDK with another agent framework.

Keep the model/provider integration isolated so it can be changed later without rewriting the business tools.

---

## 5. FREE-FIRST REQUIREMENT

The application must be built with a free-first approach.

Do NOT introduce a paid service as a mandatory requirement.

Prefer:

- free/open-source libraries
- Supabase free tier
- Gemini available free tier
- browser-native APIs
- existing framework capabilities

Do not design a feature that fundamentally requires a paid API unless explicitly approved later.

The application must remain usable within free-tier limitations wherever practical.

---

## 6. API KEY SECURITY

NEVER expose:

- Gemini API key
- Supabase service-role key
- other private secrets

to browser/client-side code.

Private environment variables must remain server-side.

Public Supabase configuration may use the appropriate public environment variables.

AI requests must go through secure server-side boundaries.

Never put private API keys into:
- React components
- client JavaScript
- public files
- source-controlled example values
- browser local storage

---

## 7. AI BUSINESS MANAGER

The AI Business Manager is a core product feature.

It must support two categories of work:

### A. Conversational intelligence

Examples:

User:
"Aj ki sales kitni hui hain?"

Agent:
- understands the request
- retrieves the correct business data
- calculates/reads the result
- explains it in the selected language

### B. Agentic actions

Examples:

User:
"Black Kurta ka stock 50 kar do."

Agent:
1. understands the goal
2. finds the correct product
3. verifies the user's business ownership
4. validates the requested value
5. requests confirmation when policy requires it
6. executes a controlled tool
7. verifies the database result
8. reports the result honestly

The AI must perform REAL application actions through tools.

It must not pretend to have performed an action.

---

## 8. AGENT TOOL ARCHITECTURE

The AI agent MUST NOT receive unrestricted database access.

The correct architecture is:

User
  ↓
AI Agent
  ↓
Controlled Tool
  ↓
Server-side Business Service
  ↓
Supabase
  ↓
Verified Result
  ↓
AI Response

Every tool must:

- validate inputs
- verify authentication
- verify business ownership
- enforce authorization
- use safe server-side services
- return structured results
- handle errors
- never expose secrets
- never execute arbitrary SQL supplied by the model/user

The agent should only receive the tools it needs.

---

## 9. AGENT ACTION SAFETY

The agent must distinguish between:

### Read actions
Usually safe to perform directly.

Examples:
- get sales
- get products
- get customers
- get inventory
- get orders
- get expenses

### Write actions
Must be validated carefully.

Examples:
- create product
- update stock
- create customer
- create order
- update order status
- create expense

### Destructive or consequential actions
Require explicit confirmation.

Examples:
- deleting important records
- cancelling important orders
- changing large quantities
- irreversible business changes

The UI should clearly show the intended action before confirmation.

Never claim success unless the backend confirms success.

---

## 10. BUSINESS DATA OWNERSHIP

Every business record must belong to the correct authenticated business/account.

The server must determine ownership from the authenticated session.

Never trust a client-provided `business_id` as sufficient authorization.

Use Supabase RLS as an additional security boundary.

A user must NEVER be able to access another user's/business's:
- products
- customers
- orders
- inventory
- sales
- expenses
- reports
- AI business context

---

## 11. AUTHENTICATION

Authentication must use Supabase Auth.

Required user-friendly methods:

- Google
- Email

The goal is to minimize friction.

Preferred flow:

Public Homepage
    ↓
Login / Continue
    ↓
Authentication
    ↓
First-time Business Setup
    ↓
Dashboard

First-time onboarding should collect only essential information:

- business name
- business type
- preferred language

Do not create a long complicated signup form.

Authentication must include:
- secure session handling
- protected routes
- logout
- appropriate loading states
- appropriate error states
- secure callbacks/redirects

---

## 12. BUSINESS MANAGEMENT MODULES

The application is intended to manage:

- Dashboard
- Products
- Categories
- Customers
- Orders
- Inventory
- Sales
- Expenses
- Reports/Insights
- Business Settings

Future modules may be added only when they provide real product value.

Do not add features merely to increase feature count.

---

## 13. HOMEPAGE

The homepage is PUBLIC.

Its purpose is to make a visitor understand the application visually before logging in.

The homepage must explain:

- what the application is
- who it is for
- what the AI does
- how the AI performs actions
- why it is more than a chatbot
- business management capabilities
- English/Roman Urdu support
- voice capability
- security/control
- how the user starts

The homepage must feel like a premium SaaS/product website.

---

## 14. HERO SECTION — LOCKED

The hero follows this structure:

LEFT SIDE:
- small product label
- main headline
- paragraph
- CTA buttons

RIGHT SIDE:
- large floating smartphone
- smartphone contains a realistic preview of the actual business application UI

The phone should visually communicate the product.

The phone is NOT a generic stock image.

It should look like a real preview of our own application.

The hero should use:
- subtle floating animation
- subtle tilt/perspective
- depth
- shadow
- emerald ambient glow
- premium motion

The mobile layout must stack gracefully.

---

## 15. VISUAL DESIGN — LOCKED

Primary visual direction:

- Obsidian / deep black
- deep charcoal
- deep emerald
- off-white

Accent lighting:

Deep Emerald → lighter Emerald glow → fading into Black

The glow can originate from:
- card corners
- background radial gradients
- behind the phone
- selected UI elements

The gradient should feel atmospheric and premium.

Avoid:
- rainbow gradients
- random bright colors
- excessive neon
- cyberpunk aesthetics
- excessive glassmorphism
- generic dashboard appearance

---

## 16. CARDS — LOCKED

Cards should feel lifted from the background.

Desired characteristics:

- visual depth
- subtle shadow
- soft glow
- layered surfaces
- slight border contrast
- hover lift
- subtle perspective
- controlled motion

Cards should NOT look like plain flat rectangles.

However, avoid excessive 3D effects that hurt usability.

---

## 17. TYPOGRAPHY — LOCKED

### Hero/display headings

Use:

Ferly

The hero heading should be:
- elegant
- thin/light
- premium
- editorial
- not heavy/bold

### Normal UI/body

Use:

Inter

Prefer:
- Light
- Regular
- Medium only when needed

Avoid unnecessarily bold typography.

Inter should be used for:
- navigation
- paragraphs
- labels
- buttons
- dashboard
- forms
- tables
- notifications
- AI interface
- Roman Urdu UI

---

## 18. DARK + LIGHT MODE

Both dark and light themes are required.

Dark mode is the primary visual expression.

Light mode must preserve the same premium visual language.

Do not turn light mode into a generic white/blue dashboard.

Maintain:
- emerald accent
- premium surfaces
- subtle depth
- good contrast
- accessible text

---

## 19. ENGLISH + ROMAN URDU

The application must support:

1. English
2. Roman Urdu

Roman Urdu is NOT optional decoration.

The selected language should affect:
- navigation
- headings
- buttons
- forms
- empty states
- errors
- notifications
- onboarding
- help text
- AI responses
- agent action explanations

Roman Urdu should be:
- natural
- simple
- understandable
- friendly
- suitable for non-technical users

Do not use overly complicated vocabulary.

User-entered business data such as product names should not automatically be translated.

---

## 20. VOICE

Voice interaction is a product capability.

Where practical, use free/browser-native functionality.

Preferred flow:

User speaks
  ↓
Speech-to-text
  ↓
AI Business Manager
  ↓
Tools/actions if needed
  ↓
Result
  ↓
Optional text-to-speech

Voice must include:
- microphone permission handling
- listening state
- processing state
- response state
- unsupported-browser fallback
- graceful errors

Do not make paid voice APIs mandatory.

---

## 21. RESPONSIVE DESIGN

The application must work across:

- small mobile
- large mobile
- tablet
- laptop
- desktop
- large desktop

Pay particular attention to:
- hero
- smartphone preview
- navigation
- sidebar
- dashboard cards
- tables
- forms
- modals
- AI chat
- buttons
- touch targets

No horizontal overflow should exist unless intentionally required.

---

## 22. ANIMATION

Use Framer Motion for premium interactions.

Good animation examples:
- page transitions
- section reveal
- card lift
- subtle hover
- phone floating
- phone perspective
- ambient glow movement
- AI activity state
- button micro-interactions

Animation must be:
- smooth
- subtle
- purposeful
- premium

Do NOT:
- animate everything
- use distracting infinite animations
- make the UI slow
- ignore reduced-motion preferences

---

## 23. ACCESSIBILITY

The application must provide:
- readable contrast
- keyboard accessibility
- visible focus states
- accessible buttons
- accessible forms
- useful labels
- appropriate ARIA only when needed
- reduced-motion support
- usable mobile touch targets

Do not sacrifice usability for visual effects.

---

## 24. DATABASE + SUPABASE

Use migrations for database changes.

Use proper relationships.

Use RLS for user/business data isolation.

Do not rely only on frontend filtering for security.

Important operations must have server-side authorization.

Avoid exposing unnecessary database fields to the client.

Prefer service-layer functions over duplicated database logic.

---

## 25. ERROR HANDLING

Every important operation must have:
- loading state
- success state where appropriate
- error state
- retry path where useful
- useful user-facing message

AI errors should be translated into understandable messages.

Never expose raw secrets, stack traces, or sensitive backend details to normal users.

---

## 26. AI RESPONSES

AI responses should be:
- concise
- helpful
- natural
- business-focused
- language-aware

For Roman Urdu:
Use simple Roman Urdu.

For example:

"Apki aaj ki total sale Rs. 25,000 hai."

Do not produce unnecessarily technical explanations for normal business users.

When an action succeeds, clearly state:
- what changed
- which item/business record was affected
- the resulting value

When an action fails:
- say it failed
- explain why when safe
- suggest the next useful step

Never fabricate results.

---

## 27. NON-TECHNICAL USER EXPERIENCE

The application should be understandable by:
- educated users
- users with limited technical knowledge
- users who are not comfortable with English

Prefer clear labels such as:

"Products"
"Customers"
"Sales"
"Expenses"
"AI Manager"

Avoid technical terminology such as:
- API
- endpoint
- database query
- schema
- token
- tool call

unless the user is explicitly viewing a technical/admin area.

---

## 28. CODE QUALITY

Write:
- clean TypeScript
- reusable components
- small focused functions
- clear naming
- strong types
- validation at boundaries
- predictable error handling

Avoid:
- giant components when unnecessary
- duplicated business logic
- unsafe `any`
- hardcoded secrets
- arbitrary magic values
- unnecessary dependencies

Do not add libraries when native/framework functionality is sufficient.

---

## 29. TESTING

After meaningful implementation:

Run appropriate:
- typecheck
- lint
- build
- unit tests where configured
- integration tests where configured

For important flows, verify:
- auth
- RLS
- CRUD
- agent tool execution
- confirmation
- language switching
- responsive UI
- error states

Fix discovered issues rather than merely reporting them.

---

## 30. QA RULE

When asked to perform QA:

DO NOT merely list problems.

You must:
1. inspect
2. reproduce where possible
3. identify root cause
4. fix
5. re-test
6. report the result

---

## 31. CURRENT-PHASE DISCIPLINE

Each prompt represents one development phase.

When a prompt is provided:

- implement only that phase
- preserve previous phases
- do not rebuild the entire application
- do not create a new project
- do not skip requirements
- do not prematurely implement unrelated future phases

If a small prerequisite change is required for the current phase, make it carefully and document it.

---

## 32. FINAL PRINCIPLE

Build this application as a real product, not as a demo.

The final experience should communicate:

"Business owner apna business manage karta hai, aur AI Business Manager uske saath actual kaam karta hai."

The AI is an intelligent operator/assistant inside the business system.

It should:
- understand
- analyze
- recommend
- act
- verify
- explain

while keeping the user in control.
````

---

## 2. AI runtime (lib/ai/)

### Files in `lib/ai/` with one-line purpose

| File | Purpose |
| --- | --- |
| `agent.ts` | Builds a fresh `Agent<AgentRunContext>` per request: name `"AI Business Manager"`, `instructions` from `buildBusinessManagerInstructions(context)`, `model: createBusinessManagerModel()`, `tools: [...businessTools]`, `temperature: 0.3`, `maxTokens: 2048`, `MAX_TURNS = 14`. |
| `caption-generator.ts` | Generates bilingual (en/ur) product marketing captions via the model chain. |
| `chat-protocol.ts` | Defines the SSE chat stream event / payload types and `ChatErrorCode` values. |
| `chat-service.ts` | Conversation + message persistence, `pending_disambiguation` storage/retrieval, idempotent message saves, conversation touch. |
| `context.ts` | `AgentRunContext` type: businessId, businessName, businessType, currencyCode, currencySymbol, language, optional imageUrl. |
| `daily-summary.ts` | Generates a daily business summary per business and inserts it as a new AI Manager conversation. |
| `disambiguation-relevance.ts` | Decides whether a stored pending disambiguation is still relevant to the current user message. |
| `disambiguation-resolver.ts` | Resolves a user's selection from a candidate list to the exact record id during chat. |
| `failover-model.ts` | `FailoverModel` wrapper: runs primary model; on a provider-level failure runs the backup. Composable as a plain `Model`. |
| `gemini-config.ts` | Gemini provider configuration (up to 8 slot keys) and `isAiConfigured()`. |
| `gemini-router.ts` | OpenAI-compatible endpoint that routes GenAI requests across up to 8 Gemini free-tier keys with failover between slots; defines `GeminiRouterError` and `findErrorInCauseChain`. |
| `gemini-thought-signatures.ts` | Carries Gemini "thought" reasoning signatures across tool-call turns so reasoning persists. |
| `groq-config.ts` | Groq backup provider configuration. |
| `groq-provider.ts` | Groq backup model provider, error classification (`GroqProviderError`, `classifyGroqFailure`), cooldown handling. |
| `model-provider.ts` | The ONLY file binding the Agents SDK to concrete providers. Builds the failover chain OpenAI → Gemini 1..8 → Groq; calls `setTracingDisabled(true)`. |
| `openai-config.ts` | OpenAI configuration (base URL override). |
| `openai-provider.ts` | OpenAI provider + error classification (`OpenAiProviderError`, `classifyOpenAiFailure`), cooldown handling. |
| `run-recovery.ts` | Decides recovery for empty final outputs / run failures (retry vs honest error) with `RecoveryState`. |
| `tools/index.ts` | Registers/exports the `businessTools` array (36 tools). |
| `tools/shared.ts` | `toolOk`, `toolFail`, `toolClarify`, `toolNeedsConfirmation` helpers and `agentCtx` business-context extraction. |
| `tools/product-tools.ts` | 8 product tools (list/find/low-stock/create/update/set-stock/adjust-stock/delete). |
| `tools/customer-tools.ts` | 6 customer tools (list/find/get-orders/create/update/delete). |
| `tools/order-tools.ts` | 7 order/sales tools (list/find/create/update-status/sales-summary/top-selling/recent-sales). |
| `tools/expense-tools.ts` | 5 expense tools (list/create/update/delete/summary). |
| `tools/overview-tools.ts` | 1 overview tool (`business_overview`). |
| `tools/marketing-tools.ts` | 1 marketing tool (`generate_product_caption`). |
| `tools/ad-campaign-tools.ts` | 1 ad-campaign tool (`create_ad_campaign`). |
| `tools/business-tools.ts` | 2 business tools (`get_business_info`, `update_business_profile`). |
| `tools/approval-tools.ts` | 4 approval tools (`publish_social_post`, `get_automation_mode`, `find_approval_action`, `execute_approved_action`). |

(SKILL.md files, handoffs, subagents, guardrails, MCP config, tracing: see "NOT FOUND" note below.)

### lib/ai/agent.ts details

- Agent name: `"AI Business Manager"` (`agent.ts:131`).
- Model: `createBusinessManagerModel()` from `lib/ai/model-provider.ts`.
- Tools: `[...businessTools]` (all 36).
- Model settings: `temperature: 0.3`, `maxTokens: 2048`.
- Turns: `MAX_TURNS = 14` (exported as `BUSINESS_MANAGER_MAX_TURNS`).

Instructions — first 60 lines of the built instruction string (from `buildBusinessManagerInstructions`, `agent.ts:52-117`; the literal text, approximate for display):

```
You are the AI Business Manager for "<businessName>" (<businessTypeLabel>).
You are not a generic chatbot: you are an operator inside this business's own management system.

Context: today's date is <today>. The business currency is <currencyCode> — always show money like "<symbol> 1,500" (thousand separators, no decimals unless needed).

LANGUAGE RULE (very important):  [en → "Reply ONLY in clear, simple English…"  |  ur → "Reply ONLY in simple, natural Roman Urdu…"]

HOW YOU WORK:
- For questions about products, stock, customers, orders, sales or expenses, ALWAYS use the tools to read real data. Never guess or invent numbers.
- If a tool does not return the data, say clearly that the information is not available. Never fill gaps with made-up figures.
- For any question involving CURRENT values (stock, prices, orders, balances), fetch fresh data with tools even if it was discussed earlier in the conversation.
- SEARCH FIRST: … ALWAYS find that existing record first and act on the found record. NEVER use a create action for something the user treats as already existing.
- If several records match a name, never pick one silently: show the matching names … ask which one they mean.
- DISAMBIGUATION BY ID: … RE-CALL the same tool passing that candidate's exact id …
- SHORT REPLIES: … treat short answers as the answer directly …
- Sales/revenue means money from completed orders. It is NOT profit …
- Keep answers concise and business-focused … do NOT use markdown symbols …

ACTIONS: … CONFIRMATION POLICY: … MARKETING PUBLISH CONFIRMATION: … ALREADY-APPROVED ACTION HANDLING: … PRIVACY & SCOPE: …
```

The full instructions also include: destructive-action confirmation (delete product/customer/expense, cancel order — disambiguate first, then confirm exactly once); publish-flow rules (full_auto vs needs_approval, "Marketing > Approvals"); already-approved action handling via `find_approval_action` / `execute_approved_action` (never create duplicate approvals); business profile read/edit capability; and privacy/scope rules (never mention other businesses or internals).

### How the failover chain works (`lib/ai/model-provider.ts`)

- Comment (lines 40-53): `OpenAI (gpt-5.6-luna) — PRIMARY` → on a real provider-level failure → `Gemini project 1..8 (existing chain)` → on whole-chain failure → `Groq backup provider`.
- OpenAI is the outermost `FailoverModel` whose backup is itself a `FailoverModel` wrapping (Gemini → Groq). When no OpenAI key is configured, the chain falls back to Gemini-primary + Groq-backup unchanged.
- `setTracingDisabled(true)` is called at `model-provider.ts:59` (tracing disabled; comment: would require OpenAI credentials we deliberately do not use).
- Provider error classification: `OpenAiProviderError`, `GeminiRouterError`, `GroqProviderError`; failures mark each provider's cooldown; the outer chain only switches on genuine provider-level failures.
- Model defaults: `OPENAI_MODEL=gpt-5.6-luna` (from `.env.example`), `GEMINI_MODEL=gemini-2.5-flash` (code default) via `GEMINI_API_KEY_1..8`, `GROQ_MODEL=openai/gpt-oss-120b`.

### OpenAI Agents SDK usage

- Actually used and verified: `import { Agent } from "@openai/agents"` (`agent.ts:3`); `run`, `user`, `assistant`, `MaxTurnsExceededError`, `ModelBehaviorError`, `UserError` from `@openai/agents` (`app/api/ai/chat/route.ts`); `tool()` from `@openai/agents` (tool files); `OpenAIChatCompletionsModel` from `@openai/agents-openai` and `Model` from `@openai/agents-core` (`model-provider.ts`); `setTracingDisabled` from `@openai/agents`.
- Version (package.json): `"@openai/agents": "^0.17.0"`.

### Tool inventory

All tools take business context from the server session (`AgentRunContext` housing `businessId`), never from the model/user-supplied `business_id`. Confirmation gates exist for destructive actions (`confirmed` flag); the approval engine (parking in `approval_actions`) is used for publish and other consequential flows.

| tool name | file | read/write | tables touched | validates business_id? | approval gate? | audit log written? |
| --- | --- | --- | --- | --- | --- | --- |
| `list_products` | product-tools.ts | read | products | no (session-derived) | no | no |
| `find_product` | product-tools.ts | read | products | no (session-derived) | no | no |
| `low_stock_products` | product-tools.ts | read | products | no (session-derived) | no | no |
| `create_product` | product-tools.ts | write | products | no (session-derived) | no | no |
| `update_product` | product-tools.ts | write | products | no (session-derived) | no | no |
| `set_product_stock` | product-tools.ts | write | products | no (session-derived) | no | no |
| `adjust_product_stock` | product-tools.ts | write | products (RPC `adjust_product_stock`) | no (session-derived) | no | no |
| `delete_product` | product-tools.ts | write | products | no (session-derived) | yes (confirmed=true) | no |
| `list_customers` | customer-tools.ts | read | customers | no (session-derived) | no | no |
| `find_customer` | customer-tools.ts | read | customers | no (session-derived) | no | no |
| `get_customer_orders` | customer-tools.ts | read | orders | no (session-derived) | no | no |
| `create_customer` | customer-tools.ts | write | customers | no (session-derived) | no | no |
| `update_customer` | customer-tools.ts | write | customers | no (session-derived) | no | no |
| `delete_customer` | customer-tools.ts | write | customers | no (session-derived) | yes | no |
| `list_orders` | order-tools.ts | read | orders | no (session-derived) | no | no |
| `find_order` | order-tools.ts | read | orders, order_items | no (session-derived) | no | no |
| `create_order` | order-tools.ts | write | orders, order_items (RPC `create_business_order`) | no (session-derived) | no | no |
| `update_order_status` | order-tools.ts | write | orders (RPC `update_order_status`; cancel requires confirmation) | no (session-derived) | yes (cancel only) | no |
| `sales_summary` | order-tools.ts | read | orders | no (session-derived) | no | no |
| `top_selling_products` | order-tools.ts | read | orders, order_items, products | no (session-derived) | no | no |
| `recent_sales` | order-tools.ts | read | orders | no (session-derived) | no | no |
| `list_expenses` | expense-tools.ts | read | expenses | no (session-derived) | no | no |
| `create_expense` | expense-tools.ts | write | expenses | no (session-derived) | no | no |
| `update_expense` | expense-tools.ts | write | expenses | no (session-derived) | no | no |
| `delete_expense` | expense-tools.ts | write | expenses | no (session-derived) | yes (confirmed=true) | no |
| `expense_summary` | expense-tools.ts | read | expenses | no (session-derived) | no | no |
| `business_overview` | overview-tools.ts | read | products, customers, orders, expenses, businesses | no (session-derived) | no | no |
| `generate_product_caption` | marketing-tools.ts | write | products (read), social_posts (draft + caption) | no (session-derived) | no | no |
| `create_ad_campaign` | ad-campaign-tools.ts | write | ad_campaigns; checks connected_accounts / meta_ad_accounts | no (session-derived) | money/ad sensitive (parked in needs_approval) | approval_events (when parked) |
| `get_business_info` | business-tools.ts | read | businesses | no (session-derived) | no | no |
| `update_business_profile` | business-tools.ts | write | businesses | no (session-derived) | no | no |
| `publish_social_post` | approval-tools.ts | write | social_posts, approval_actions, approval_events | no (session-derived) | yes (needs_approval mode; full_auto when safe + explicit confirmation) | approval_events |
| `get_automation_mode` | approval-tools.ts | read | automation_settings | no (session-derived) | no | no |
| `find_approval_action` | approval-tools.ts | read | approval_actions | no (session-derived) | no | no |
| `execute_approved_action` | approval-tools.ts | write | approval_actions, approval_events, + executor tables (e.g. social_posts) | no (session-derived) | yes (claim via `claim_approval_action`) | approval_events |

### SKILL / handoffs / subagents / guardrails / MCP / tracing

- SKILL.md files: NOT FOUND (a repo-wide glob for `**/SKILL.md` / skill files returned nothing).
- Handoffs: NOT FOUND (`agent.ts` defines no `handoffs`); no `handoff` symbols imported anywhere.
- Subagents: NOT FOUND.
- Guardrails: NOT FOUND (no `guardrails` options on the Agent).
- MCP usage: NOT FOUND (no MCP config in the repo).
- Tracing: explicitly disabled via `setTracingDisabled(true)` in `lib/ai/model-provider.ts:59` (found — as a deliberate disable, not an active trace).

---

## 3. Database (supabase/migrations/)

### All migration files in order (42 files)

```
20260821000000_create_businesses.sql
20260821010000_grant_businesses_table_privileges.sql
20260821020000_create_products.sql
20260821030000_grant_products_table_privileges.sql
20260821040000_product_images_storage.sql
20260821050000_create_profiles.sql
20260821060000_grant_profiles_table_privileges.sql
20260822000000_create_customers.sql
20260822010000_grant_customers_table_privileges.sql
20260822020000_create_orders.sql
20260822030000_grant_orders_table_privileges.sql
20260822040000_create_expenses.sql
20260822050000_grant_expenses_table_privileges.sql
20260822060000_create_adjust_stock_function.sql
20260823000000_create_ai_conversations.sql
20260823010000_grant_ai_conversations_messages_privileges.sql
20260826000000_add_image_url_to_ai_messages.sql
20260826010000_add_pending_disambiguation.sql
20260827090000_orders_delete_rls_policy.sql
20260828000000_create_order_complete_on_create.sql
20260828120000_fix_create_order_completed_branch.sql
20260828140000_create_marketing_tables.sql
20260828150000_grant_marketing_tables_privileges.sql
20260831140000_add_bilingual_captions_to_social_posts.sql
20260831160000_create_wallet_transactions.sql
20260831170000_grant_wallet_transactions_privileges.sql
20260831180000_fix_wallet_spend_ensure_wallet_exists.sql
20260831190000_simulate_test_spend_allow_negative.sql
20260901000000_meta_ads_connect.sql
20260901010000_grant_meta_ad_accounts_privileges.sql
20260901020000_create_automation_settings.sql
20260901030000_create_approval_actions.sql
20260901040000_create_weekly_report_deliveries.sql
20260901050000_create_marketing_videos.sql
20260901060000_grant_phase4_tables_privileges.sql
20260902090000_add_meta_oauth_connected_account_columns.sql
20260906090000_add_external_post_reference_to_social_posts.sql
20260909000000_create_whatsapp_message_status.sql
20260909010000_grant_whatsapp_message_status_privileges.sql
20260909020000_create_whatsapp_inbound_events.sql
20260909020001_grant_whatsapp_inbound_events_privileges.sql
20260911000000_normalize_business_phone.sql
20260912000000_fix_business_phone.sql
```

### Table inventory (columns + RLS)

| Table | Key columns | RLS |
| --- | --- | --- |
| `businesses` | id, owner_id (FK auth.users, **unique**), name, business_type, currency, language, phone, address, setup_completed, created_at, updated_at | enabled |
| `products` | id, business_id (FK), name, description, category, price, stock_quantity, low_stock_threshold, sku, image_url, is_active, created_at, updated_at | enabled |
| `profiles` | id (FK auth.users), email, display_name, avatar_url, preferred_language, created_at, updated_at | enabled |
| `customers` | id, business_id (FK), name, phone, email, address, notes, created_at, updated_at | enabled |
| `orders` | id, business_id (FK), customer_id, order_number (auto `ORD-xxxxxx`), status (default `pending`; check constraint), subtotal, discount, total, created_at, updated_at | enabled |
| `order_items` | id, order_id (FK, cascade), product_id, quantity, unit_price, created_at | enabled |
| `expenses` | id, business_id (FK), title, amount, category, expense_date, notes, created_at, updated_at | enabled |
| `ai_conversations` | id, business_id (FK), title, created_at, updated_at | enabled |
| `ai_messages` | id, conversation_id (FK), business_id, role (`user`/`assistant`), content, actions (jsonb), image_url, pending_disambiguation (jsonb), created_at | enabled |
| `social_posts` | id, business_id (FK), product_id (nullable), platform, caption, caption_en, caption_ur, selected_language, status (default `draft`), media_url, scheduled_at, published_at, external_post_id, created_at, updated_at | enabled |
| `ad_campaigns` | id, business_id (FK), platform, goal/objective fields, budget_type, daily_budget, monthly_budget_cap, spend_to_date, status, start_date, end_date, created_at, updated_at | enabled |
| `marketing_wallet` | id, business_id (FK, unique), balance, created_at, updated_at | enabled |
| `connected_accounts` | id, business_id (FK), platform, status, account_label, access_token, token_expires_at, external_account_id, created_at, updated_at; unique (business_id, platform) | enabled |
| `wallet_transactions` | id, business_id (FK), type (`topup`/`spend`/`adjustment`), amount, balance_after, gateway_reference, description, status (`pending`/`completed`/`failed`), created_at | enabled |
| `meta_ad_accounts` | id, business_id (FK), meta ad account identifiers, status, created_at, updated_at | enabled |
| `automation_settings` | id, business_id (FK, unique), mode (`needs_approval`/`full_auto`), created_at, updated_at | enabled |
| `approval_actions` | id, business_id (FK), user_id, action_type, action_payload (jsonb), summary, approval_mode, status (pending/approved/rejected/executing/completed/failed/expired/cancelled), idempotency_key, created_at, updated_at, expires_at, approved_at, rejected_at, approved_by, rejected_by, executed_at, execution_result (jsonb), execution_error, external_reference; unique index (business_id, idempotency_key) | enabled |
| `approval_events` | id, approval_action_id (FK, cascade), business_id (FK), event, detail (jsonb), created_at | enabled |
| `weekly_report_deliveries` | id, business_id (FK), week_start, delivery_status (pending/sent/skipped/failed), report_payload, delivery_error, delivered_at, created_at, updated_at; unique (business_id, week_start) | enabled |
| `marketing_videos` | id, business_id (FK), storage_path, file_name, mime_type, file_size_bytes, duration_seconds, caption_en, caption_ur, caption, hashtags, suggested_post_time, status (uploaded/ai_generated/reviewing/approved/rejected), review_decision, approval_action_id, created_at, updated_at | enabled |
| `whatsapp_message_status` | id, business_id (FK), message_id (unique), recipient_phone, status (sent/delivered/read/failed), provider_timestamp, errors (jsonb), created_at, updated_at | enabled |
| `whatsapp_message_id_map` | id, business_id (FK), provider_message_id (unique), recipient_phone, created_at | enabled |
| `whatsapp_inbound_events` | id, business_id (FK nullable), sender_phone, body, provider_message_id (unique), created_at | enabled |

Storage buckets referenced in migrations:
- `product-images` (owner-scoped policies: upload/update/delete via `owns_product_image_path(text)` RPC — `20260821040000_product_images_storage.sql`).
- `marketing-videos` (owner upload/read policies — `20260901050000_create_marketing_videos.sql`).

### Existence check of the specifically-requested tables

| Table | Found? |
| --- | --- |
| `businesses` | ✅ FOUND (name matches; has `business_type` column) |
| `business_memberships` | ❌ NOT FOUND (ownership is single `owner_id` unique on `businesses`) |
| `products` | ✅ FOUND |
| `product_variants` | ❌ NOT FOUND |
| `inventory_locations` | ❌ NOT FOUND |
| `inventory_balances` | ❌ NOT FOUND |
| `inventory_movements` | ❌ NOT FOUND (stock is a plain column; `adjust_product_stock` mutates it; there is no stock movement ledger) |
| `customers` | ✅ FOUND |
| `suppliers` | ❌ NOT FOUND |
| `orders` | ✅ FOUND |
| `order_items` | ✅ FOUND |
| `payments` | ❌ NOT FOUND |
| `expenses` | ✅ FOUND |
| `returns` | ❌ NOT FOUND |
| `return_items` | ❌ NOT FOUND |
| `audit_logs` | ❌ NOT FOUND (no general audit table; the approval flow writes an audit trail to `approval_events`) |
| `approvals` | Partial — no table literally named `approvals`, but the equivalent exists: `approval_actions` + `approval_events` |
| events/job-queue table | ❌ NOT FOUND (no queue/scheduled-event table) |

### businesses.business_type and idempotency_key usage

- `businesses.business_type`: YES ✅ (`business_type text`, created in `20260821000000_create_businesses.sql`).
- `idempotency_key` usage: YES ✅ — `approval_actions.idempotency_key` (unique per business); plus equivalent idempotency mechanisms: `weekly_report_deliveries` unique `(business_id, week_start)`; `whatsapp_message_id_map.provider_message_id` unique; `whatsapp_inbound_events.provider_message_id` unique; `whatsapp_message_status.message_id` unique; order stock deduction idempotent via `stock_applied` field; `process_wallet_spend` row-locks the wallet.

### Existing RPCs / DB functions (name + one-line purpose)

| Function | Purpose |
| --- | --- |
| `set_updated_at()` | Trigger function that maintains `updated_at` on update. |
| `handle_new_user()` | Auth trigger that creates the `profiles` row for a new user. |
| `owns_product_image_path(text)` | Storage RPC validating that a storage object path belongs to the caller's business (used by `product-images` bucket policies). |
| `adjust_product_stock(uuid, integer)` | Atomically adjusts `products.stock_quantity`. |
| `create_business_order(jsonb)` | Creates an order + items + stock deduction in one transaction; latest version (final in `20260828120000`) supports a `completed` branch with `stock_applied` tracking; returns `orderStatus` from the DB. |
| `update_order_status(uuid, text)` | Updates order status (idempotent; `completed` applies stock once). |
| `delete_business_order(uuid)` | Deletes an order and its items through the RLS-scoped service path. |
| `create_pending_topup(...)` | Wallet: creates a `pending` topup transaction. |
| `process_wallet_topup(...)` | Wallet: confirms and credits a topup to the wallet balance. |
| `process_wallet_spend(...)` | Wallet: atomic spend with row lock; 2nd version additionally ensures a wallet row exists first. |
| `fail_pending_topup(...)` | Wallet: marks a pending topup `failed`. |
| `claim_approval_action(uuid)` | Atomically claims an `approval_actions` row (`approved`|`pending` → `executing`, set `executed_at`), returning the row, so double execution is impossible; `security definer`, granted to `authenticated` + `service_role`. |

No `pg_cron`, scheduled functions, or `create extension` statements exist in the migration set.

### RLS + anon-grant analysis (item from fix2)

Every table's SQL grants include `with grant option`-style `grant select, insert, update, delete to anon` (plus `authenticated` and `service_role`) — this is a deliberate pattern in every grants migration ("RLS policies never replace SQL-level GRANTs — Postgres checks table privileges first"). The question is whether `anon` can actually read/write given RLS.

All 23 tables have RLS **enabled** and use **owner-scoped policies** of the form `exists (select 1 from businesses b where b.id = <business_id> and b.owner_id = (select auth.uid()))`. For `anon`, `auth.uid()` is NULL, so owner-scoped policies never match → the `anon` GRANTs are functionally inert for selection, insertion, update, and deletion on every owner-scoped table: `businesses`, `products`, `profiles`, `customers`, `orders`, `order_items`, `expenses`, `ai_conversations`, `ai_messages`, `social_posts`, `ad_campaigns`, `marketing_wallet`, `connected_accounts`, `wallet_transactions`, `meta_ad_accounts`, `automation_settings`, `approval_actions`, `approval_events`, `weekly_report_deliveries`, `marketing_videos`.

Exceptions — the specifically-named `Service role can …` policies do NOT actually restrict to the service role. They use `with check (true)` / `using (true)`:

1. `whatsapp_inbound_events` (`20260909020000`):
   - select: owner-scoped → anon denied.
   - insert: policy `with check (true)` → **anon CAN insert** raw rows.
   - update / delete: no policies → denied.
2. `whatsapp_message_status` (`20260909000000`):
   - select: owner-scoped → anon denied.
   - insert: policy `with check (true)` → **anon CAN insert**.
   - update: policy `using (true) with check (true)` → **anon CAN update ANY row** (arbitrary `business_id`, `status`, `message_id`, …).
   - delete: no policy → denied.
3. `whatsapp_message_id_map` (`20260909000000`):
   - select: owner-scoped → anon denied.
   - insert: policy `with check (true)` → **anon CAN insert**.
   - update / delete: no policies → denied.
4. `approval_actions` / `approval_events` (`20260901030000`): all four operations owner-scoped → **anon fully blocked** despite the anon grants.

Finding: an anonymous (unauthenticated) caller can insert into `whatsapp_inbound_events`, `whatsapp_message_status`, and `whatsapp_message_id_map`, and can update any row of `whatsapp_message_status`. The intended writers (the WhatsApp webhook) use the service-role client which bypasses RLS anyway, so these `with check (true)` policies are the only thing letting `anon` write, and they were evidently written to be "service role can insert/update" but never constrain `auth.role()`.

---

## 4. Marketing and integrations

### lib/marketing/ — files and purpose

| File | Purpose |
| --- | --- |
| `ad-budget-planner.ts` | Suggests a daily ad budget from a monthly cap + safety margin (95% target). |
| `approval-executors.ts` | Registry of per-action-type executors wired once server-side (`configureApprovalExecutors`, `getApprovalExecutors`). |
| `approval-service.ts` | Approval engine: automation-mode decision, parking actions as `pending`, claiming + executing, finalizing, notifying owners; calls `sendApprovalRequest` when an action is parked. |
| `approval-types.ts` | `ApprovalAction` type, action-type union, lifecycle statuses. |
| `automation.ts` | Reads/writes `automation_settings.mode` (needs_approval / full_auto). |
| `facebook-publish.ts` | Real Facebook Page publishing via Graph API (`/{page-id}` + `post`/`photos` endpoints). |
| `instagram-publish.ts` | Two-step Instagram publishing: create media container, then `media_publish`. |
| `meta-config.ts` | Meta app config + `isMetaConfigured()`. |
| `meta-oauth.ts` | Meta OAuth: authorize URL, signed `state`, code exchange, `discoverPage`/`discoverInstagram`, `debug_token` introspection, per-Page token probing, business-asset fallback. |
| `payment-provider.ts` | Payment-gateway abstraction (connector interface) used for wallet topups. |
| `publish.ts` | Publish orchestration (per-platform dispatch: facebook / instagram). |
| `service.ts` | Marketing service layer: connection checks, `connectMetaAccount`, capabilities/backfill helpers. |
| `social-posts.ts` | Social-post service: draft creation, bilingual caption backfill, `publishSocialPost` coordination. |
| `types.ts` | Marketing types (connected accounts, connections, capability flags). |
| `video-content.ts` | AI caption/hashtag/suggested-time generation for marketing videos. |
| `video-service.ts` | Marketing-video storage upload (`marketing-videos` bucket) + review workflow. |
| `wallet-service.ts` | Wallet topup/spend/balance via `process_wallet_*` RPCs. |
| `weekly-report.ts` | Weekly marketing-report generation and background delivery. |
| `whatsapp/approval-notify.ts` | **Proactive** WhatsApp approval-request sender (on current branch). |
| `whatsapp/message.ts` | Builds the approval-request message text + generates an approval reference. |
| `whatsapp/phone.ts` | Phone normalization, E.164 conversion, `matchesBusinessPhone`. |
| `whatsapp/provider.ts` | WhatsApp Cloud API provider: send text, parse inbound webhook, verify webhook, status handling. |
| `whatsapp/reply-parser.ts` | Parses YES / NO / ambiguous approval replies. |
| `whatsapp/signature.ts` | HMAC-SHA256 verification of `x-hub-signature-256`. |
| `whatsapp/whatsapp-service.ts` | Inbound approval-reply processor (owner-phone check, dedup, claim + execute via `claim_approval_action`). |

### All routes under app/api/ [route | method | auth check]

16 route files:

| Route | Method | Purpose | Auth check present? |
| --- | --- | --- | --- |
| `/api/ai/chat` | POST | Streams the AI Business Manager agent chat (Agent SDK `run`, SSE events, disambiguation, recovery) | Yes — `getServerUser()` session; business from ownership, not request body |
| `/api/ai/conversations` | GET | List/search AI conversations | Yes — `getServerUser()` |
| `/api/ai/conversations/[id]` | GET, DELETE | Fetch/delete one conversation | Yes — `getServerUser()` |
| `/api/ai/conversations/[id]/messages` | DELETE | Delete messages after a given message id | Yes — `getServerUser()` |
| `/api/ai/summary` | POST | Generate daily summaries (designed for Vercel Cron / manual trigger) | Yes — `Authorization: Bearer ${CRON_SECRET}` |
| `/api/ai/upload` | POST | Product image upload (5 MB, `product-images` bucket) | Yes — `getServerUser()` |
| `/api/cron/weekly-report` | POST | Weekly report delivery across businesses | Yes — `x-cron-secret` header vs `CRON_SECRET`/`CRON_AUTH_TOKEN`; service-role client |
| `/api/debug/diagnose` | GET | Alignment diagnostic described in docs/phase0.txt | Yes — `getServerUser()` only; **no production guard** (file comment says "NEVER expose this in production") |
| `/api/marketing/backfill` | POST | Per-business marketing-draft backfill (idempotent) | Yes — `getServerUser()` |
| `/api/marketing/backfill-all` | POST | ADMIN-ONLY global backfill across every business | Yes — `getServerUser()` + requires server-side service-role key (403 `no_service_role`) |
| `/api/marketing/diag/instagram` | GET | Instagram connection diagnostic (evidence-first; returns raw Meta responses) | Yes — `getServerUser()` + `getUserBusiness()` |
| `/api/marketing/oauth/callback` | GET | OAuth callback: verify signed `state`, exchange code, discover + connect, redirect back | Yes — `getServerUser()` + HMAC state verification; tokens never leaked |
| `/api/marketing/oauth/connect` | GET | Build the Facebook dialog authorize URL | Yes — `getServerUser()` + platform validation + `isMetaConfigured()` |
| `/api/marketing/videos/upload` | POST | Video upload (50 MB, `marketing-videos` bucket) + AI metadata | Yes — `getServerUser()` |
| `/api/whatsapp/test-send` | POST | Send a real WhatsApp test message via provider | Yes — `x-cron-secret` header (401 otherwise) |
| `/api/whatsapp/webhook` | GET, POST | GET: subscription verification (echoes challenge on verify-token match). POST: inbound messages + status updates | Yes — GET: `provider.verifyWebhook`; POST: HMAC `x-hub-signature-256` vs `WHATSAPP_APP_SECRET` verified against the raw body **before** the payload is trusted |

### Meta OAuth — token storage and encryption

- Tokens are persisted by `connectMetaAccount` (`lib/marketing/service.ts:355-387`) as a plaintext `access_token` in `connected_accounts` (`by business_id, platform` upsert), along with `token_expires_at` and `external_account_id`.
- **Tokens are NOT encrypted at rest.** A repo-wide grep for `encrypt|cipher|decrypt|createCipheriv|node:crypto` in `lib/` found only `createHmac`/`timingSafeEqual` in `lib/marketing/meta-oauth.ts` (used to sign the OAuth `state` for CSRF/state forgery protection, not for token storage).
- Token hygiene: logs redact `access_token` values (`access_token=<redacted>`); `meta-oauth.ts` strips any `access_token` property from parsed Graph API bodies before logging; `debug_token` URL embeds `${appId}|${appSecret}` and that value is never written to logs.
- RLS confines `connected_accounts` to the owning business (owner-scoped policies); tokens are only readable server-side through the session-bound service.

### WhatsApp

- Webhook route: `app/api/whatsapp/webhook/route.ts` (GET verify + POST inbound).
- HMAC verification: implemented — `lib/marketing/whatsapp/signature.ts` `verifyHubSignature()` validates `x-hub-signature-256` (`sha256=`) over the raw request body using `WHATSAPP_APP_SECRET` with constant-time comparison, called before parsing the payload (route returns 401 on failure).
- Approval handler: `lib/marketing/whatsapp/whatsapp-service.ts` `processInboundReply()` — resolves the sender's business by phone, requires the sender be the business **owner** (`owner_id` check), requires a pending action with `external_reference`, dedupes by `provider_message_id`, then executes through `claim_approval_action` RPC and the executor registry; ambiguous replies trigger a localized YES/NO clarification.
- Proactive notification code: **EXISTS on the current branch** — `lib/marketing/whatsapp/approval-notify.ts` (`sendApprovalRequest`), invoked automatically by `lib/marketing/approval-service.ts` (`notifyApprovalRequested`) whenever an action is parked as pending. It writes an `approval_events` row (`event='notified'`) and a `whatsapp_message_id_map` mapping.

### Instagram

- Current path (per `lib/marketing/instagram-publish.ts`, `lib/marketing/meta-oauth.ts`):
  1. **Connect**: OAuth via Facebook Login dialog → `verifyState` → `exchangeCodeForToken` → `discoverPage`:
     - `GET /me/accounts?fields=id,name,access_token,instagram_business_account`.
     - For each Page missing the nested `instagram_business_account`, probe the Page node (`GET /{page-id}?fields=instagram_business_account`) first with the Page's own token, then with the user token.
     - Business-asset fallback: `me/businesses` → `{business_id}/instagram_business_accounts` when every Page edge is absent.
     - `debug_token` introspection logs granted scopes on failure.
     - Selects the first Page with a linked Instagram Business account; plain Facebook connect accepts any Page.
  2. **Publish**: two-step Graph flow — `POST /{ig-user-id}/media` (container) then `POST /{ig-user-id}/media_publish`; only reached when a connected Instagram account exists with a valid `access_token` + `external_account_id`.
- Historical failure mode (now addressed): Meta returning HTTP 200 with the `instagram_business_account` field absent even for linked Pages, and `/me/accounts` not returning each Page's `access_token`. The code now requests `access_token` explicitly and probes; the diagnostic endpoint `app/api/marketing/diag/instagram` was added for evidence-based debugging.
- Test evidence: `tests/marketing/meta-oauth-discover.test.mjs` (30/30 PASS, includes production-exact regression cases where the field is absent).
- If no connection/token exists, publishing refuses honestly with a structured error (never fabricates success).

---

## 5. Background and automation

- `vercel.json`: **NOT FOUND** (a repo-wide glob returned nothing; a `.vercel/` directory exists at root and is git-ignored).
- Queue / scheduled functions / event tables: **NOT FOUND** — no queue table, no event/job table, and no `pg_cron`/`create extension` in migrations.
- Cron-style endpoints (designed to be called by Vercel Cron or an external scheduler): `/api/cron/weekly-report` (`x-cron-secret` header) and `/api/ai/summary` (`Authorization: Bearer CRON_SECRET`).
- The marketing-draft backfill runs on-demand (authenticated owner) or via the admin-only `/api/marketing/backfill-all`; nothing is scheduled in-repo.

---

## 6. Tests

- Framework: no third-party runner — plain Node.js ESM scripts executed via `node --conditions=react-server --import <hook-file>.mjs <test-file>.mjs` with homemade `PASS/FAIL` assertions and a summary count. Hooks/stubs (`tests/ai/stubs`, `tests/marketing/*-stubs`, `register-hooks.mjs`, `load-hooks`) map `next/headers`, `server-only`, and service modules for the agent/marketing tests.
- Test assets:
  - `tests/ai/`: `business-tools.mjs` (tool test suite), `failover-matrix.mjs`, `consecutive-requests.mjs`, plus provider/router/live-probe scripts and hooks/stubs.
  - `tests/marketing/`: `ad-budget-planner.test.mjs`, `ad-campaign-tool.test.mjs`, `meta-oauth-discover.test.mjs` (+ ad-campaign hooks/stubs).
  - `tests/qa/`: many Playwright-driven (`playwright-core`) QA scripts and screenshots, plus perf results and fixtures.
- Results run during this audit (read-only):
  - `npm run test:budget-planner` → **PASS 14/14** checks.
  - `npm run test:meta-oauth` → **PASS 30/30** checks (incl. production-exact discovery regression cases; access tokens redacted in output).
  - `npm run test:tools` → **BLOCKED (does not start)** — `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode` at `lib/marketing/whatsapp/provider.ts:103` (`private readonly token: string`, `private readonly phoneNumberId: string`) under Node.js `v24.19.0`. Per instructions, this is reported but not fixed.
  - `npm run test:failover` → executed earlier in the audit; the visible individual checks (1, 2, 5) passed, but the terminal's final aggregate summary was not captured in full, so an overall pass/fail verdict cannot be asserted here.

---

## 7. Git and deployment state

- Current branch: `main` (tracks `origin/main`).
- Last 15 commits (one line each):
  1. `224ade5 fix(whatsapp): ensure approval-request notifications always fire (Part 2) + webhook executor auth (Part 1)`
  2. `e9213bc feat(whatsapp): proactive approval-request notifications + owner phone (DINS) repair migration`
  3. `36634e2 fix(whatsapp): normalize business phone so inbound approval replies match`
  4. `b03c277 fix: consistent vertical spacing between card sections on Marketing, Approvals, and Video pages`
  5. `4ca6326 fix: Approvals/Video cards text overflow on mobile`
  6. `159f66d diagnostic: add webhook arrival logging before signature check for inbound debugging`
  7. `573a77a feat: persist inbound WhatsApp webhook events for debugging`
  8. `0e683b9 fix: wire WhatsApp approval notifications + fix idempotency + localized clarifications`
  9. `b50c332 fix: secure WhatsApp test-send endpoint with server-only and CRON_SECRET auth`
  10. `e6c0645 feat: WhatsApp outbound status persistence, test-send endpoint, and provider upgrade`
  11. `f1ad503 feat: add Instagram connection diagnostic endpoint for evidence-first debugging`
  12. `75b6a33 feat: add Delete option to all marketing activity and approval cards`
  13. `4837767 fix: ensure social_posts status updates after successful publish`
  14. `3ab3296 fix: AI no longer asks for re-approval when action is already completed`
  15. `656ff33 fix: prevent duplicate approvals and add find/execute approval tools`
- Uncommitted changes (from `git status --short`):
  - Modified: `dev-server.log`, `docs/fix.txt`, `supabase/.temp/cli-latest`
  - Untracked: `docs/fix.txt.md`
- Vercel rollback: no git commit message in history references a Vercel rollback (`git log --all -i --grep "vercel|rollback"` returned a single unrelated commit about Instagram OAuth discovery). `vercel.json` is NOT FOUND; a `./.vercel` directory exists (git-ignored), and `docs/*`, root `*.log` files, and commit history indicate the app has been developed and run locally (ports 3000/3001) and prepared for Vercel deployment.

---

## 8. Security check

- Hardcoded secrets in source: **NOT FOUND**. A secret-pattern scan over `app`, `lib`, `components`, `scripts`, `supabase`, `middleware.ts`, `next.config.ts` (excluding test/stub files) found no OpenAI `sk-…`, Gemini `AIza…`, Supabase JWTs / `sbp_…`, AWS `AKIA…`, Slack tokens, GitHub `ghp_…`, or private key blocks.
- Committed secrets in git history: **NOT FOUND**. `git ls-files` and `git log --all --name-only` show only `.env.example` (placeholders) ever tracked; no `.env`, credential, key, or secret file names appear in history.
- `.env` in `.gitignore`: YES ✅. `.gitignore` ignores `.env*` with an allow-list `!.env.example` (and `*.tsbuildinfo`, `out/`, `.next*`, `.vercel`, `build`, etc.). `.env.local` exists on disk but is untracked.
- Server-side secrets: all AI/Meta/WhatsApp keys are read server-side only (`server-only` modules); `.env.example` documents them as SERVER-SIDE ONLY and contains only placeholder values.
- Findings relevant to security posture (see Section 3 RLS analysis and Section 2 middleware note):
  - `anon` can insert into `whatsapp_inbound_events`, `whatsapp_message_status`, `whatsapp_message_id_map`, and update any `whatsapp_message_status` row — because the "Service role can insert/update" policies use `with check (true)`/`using (true)` instead of `auth.role() = 'service_role'`, combined with anon SQL grants.
  - `app/api/debug/diagnose` requires only an authenticated session and has no environment guard despite its "NEVER expose this in production" comment; `middleware.ts` protects only `/dashboard` and `/setup` (not `/api/*`) — see Section "middleware.ts check" below.
  - Meta OAuth access tokens are stored in plaintext in the database (`connected_accounts.access_token`); no at-rest encryption.

---

## middleware.ts — does it protect app/api/debug/diagnose in production?

- `middleware.ts` protects only `/dashboard` and `/setup` (`PROTECTED_PREFIXES`) by redirecting to `/login` when there is no valid session. The middleware matcher runs on all non-static paths, but for `/api/*` it does not perform any protection logic (no `/api` prefix in `PROTECTED_PREFIXES`).
- Therefore `app/api/debug/diagnose` is **NOT protected by middleware**. It performs its own `getServerUser()` auth check (so an unauthortized caller gets 401), but any authenticated user can hit it; there is no check that the deployment is non-production. Its responses are narrowed by RLS to the caller's own business (session-bound client), yet the file's own comment instructs "NEVER expose this in production" — that guard is not implemented and would not come from middleware.

---

## FINAL OUTPUT — Observed vs FILE 1 (project context / AGENTS.md) claims

Where "FILE 1" claims = the statements in the project context (AGENTS.md). Anything that contradicts or extends it:

1. **Model provider ordering (contradiction / extension).** AGENTS.md §4 says "Gemini as the intended model provider using an available free tier." The code actually runs **OpenAI `gpt-5.6-luna` as the PRIMARY model**, with Gemini 1..8 as the backup chain and Groq (`openai/gpt-oss-120b`) as the final fallback (`lib/ai/model-provider.ts`). Gemini remains in the chain as fallback, so this is an extension of (not a removal of) the intended design.
2. **Inventory module (contradiction).** AGENTS.md §12 lists Inventory (and Categories) as management modules. The repo has no `inventory_locations` / `inventory_balances` / `inventory_movements` tables and no dedicated Inventory UI; stock is a single `products.stock_quantity` column mutated by `adjust_product_stock`. Categories exist only as a free-text `products.category` column, not a table.
3. **Business membership model (extension).** AGENTS.md §10 and §11 describe per-account ownership. The schema enforces **one business per owner** (`businesses.owner_id` UNIQUE); there is no `business_memberships` table for multi-user businesses.
4. **OpenAI Agents SDK (confirmed claim).** AGENTS.md §4 mandates OpenAI Agents SDK for orchestration and isolation of the provider layer. Confirmed: `@openai/agents ^0.17.0` is used (`Agent`, `run`, `tool`, errors), and `model-provider.ts` is the single binding point to concrete providers. Tracing is explicitly disabled (`setTracingDisabled(true)`), which AGENTS.md does not mention.
5. **Free-first (confirmed claim).** No paid service is mandatory: Gemini free tier + Groq free keys + WhatsApp/Meta free-to-start; voice uses browser-native APIs (`components/ai/use-voice-turn.ts`, `voice-panel.tsx`, `components/home/voice-capability.tsx`); wallet topups route through an abstraction (`payment-provider.ts`) and the test-spend path is explicitly simulated.
6. **Auth methods (partial).** AGENTS.md §11 requires Google + Email. The repo uses Supabase Auth with email flow verified in `middleware.ts`/`app/(auth)` code; **Google sign-in was not observed** in the code paths inspected during this audit (NOT VERIFIED, not confirmed absent).
7. **Business data ownership + RLS (confirmed claim).** AGENTS.md §10 (server-derived ownership, never client `business_id`) matches the code: tools take `businessId` from `AgentRunContext` (session-derived) and all owner-scoped RLS policies are enforced client-side via session-bound clients.
8. **AI as real operator (confirmed claim).** AGENTS.md §7/§9 (real actions, verification, honest reporting, confirmation gates) match the implementation: confirmation-gated `delete_*`/cancel tools, order creation returns DB truth (`orderStatus`), order-completed stock application is idempotent, and publish flows run through a real approval engine (`approval_actions`/`approval_events`, `claim_approval_action`).
9. **Homepage / design system (confirmed claim).** AGENTS.md §13-18 requirements (premium SaaS homepage, smartphone preview hero, obsidian/emerald visual language, Ferly + Inter typography, dark/light mode) are implemented in `app/(marketing)`/homepage components and Tailwind theme (`components/home/*`, hero phone preview).
10. **Security claim at rest (contradiction with AGENTS.md §6 spirit).** AGENTS.md forbids exposing keys to the client (honored) but is silent on at-rest token encryption; the audit found Meta OAuth `access_token`s stored **in plaintext** in `connected_accounts` (RLS-protected, server-only access, but not encrypted).
11. **GRANTs vs RLS hardening gap (extends AGENTS.md §24).** AGENTS.md says "Use RLS for user/business data isolation" and "Important operations must have server-side authorization." The database is hardened that way, except for the WhatsApp tables where `anon` retains insert (and update on `whatsapp_message_status`) ability through unconstrained `with check (true)` / `using (true)` policies.
12. **Extras beyond AGENTS.md.** The repo extends the AGENTS.md module list with a substantial Marketing suite (social posts, ad campaigns, wallet, Meta OAuth, WhatsApp notifications, marketing videos, weekly reports) and AI support features (Gemini thought-signature carry, disambiguation, run recovery, daily summaries, caption generation) — none contradict AGENTS.md; they extend it under "future modules provide real product value."
13. **Testing discipline (confirmed claim).** AGENTS.md §29's test/lint/typecheck expectations are matched by `package.json` scripts (`lint`, `typecheck`, several `test:*` suites); note that `test:tools` currently cannot execute under Node 24 (reported above, not fixed).