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
