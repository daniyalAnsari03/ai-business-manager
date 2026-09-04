# AI Business Manager

> An AI-powered business management platform that helps businesses manage products, inventory, customers, orders, expenses, sales, and daily operations through an intelligent business assistant.

## Overview

**AI Business Manager** is a full-stack business management application built to make everyday business operations simpler through a combination of a modern management dashboard and an intelligent AI assistant.

Instead of functioning as a simple chatbot, the AI assistant is designed to work with real business data, use controlled business tools, reason about user requests, handle ambiguous records, perform approved operations, and return results based on authoritative application data.

The platform supports core business operations including products, inventory, customers, orders, expenses, sales, and business overview information.

The application is designed with a premium, responsive interface that works across desktop, laptop, tablet, and mobile devices.

---

## ✨ Key Features

### 🤖 AI Business Assistant

* AI-powered conversational business assistant
* Business-aware responses
* Controlled tool-based business operations
* Real business data retrieval
* Product, customer, order, and business-data operations through AI tools
* Ambiguous record detection and clarification
* ID-based targeting for safer business actions
* Confirmation-aware destructive operations
* Authoritative database results used for final responses
* Streaming AI responses
* Persistent conversations
* New conversation support
* Conversation search
* Conversation selection and deletion
* Message editing
* AI response regeneration
* Copy response functionality

### 📦 Product Management

* Create products
* Update product information
* Delete products with confirmation
* Product categories
* Product pricing
* Stock quantity management
* Low-stock thresholds
* SKU support
* Product descriptions
* Active/inactive product state
* Product image upload
* Product image display
* Low-stock overview
* Search products
* AI-powered product operations

### 📊 Inventory Management

* Real-time stock quantities
* Stock updates
* Low-stock detection
* Inventory-aware order processing
* Stock deduction when orders are completed
* Atomic stock handling for completed orders
* Protection against stock-update race conditions

### 👥 Customer Management

* Create customers
* Update customer information
* Customer contact details
* Customer address information
* Customer order history
* Delete customers
* AI-powered customer operations
* Duplicate-name handling
* Customer disambiguation

### 🛒 Order Management

* Create orders
* Order item management
* Customer association
* Product association
* Order totals and discounts
* Order status management
* Pending orders
* Completed orders
* Cancelled orders
* Order details
* Order history
* Stock deduction for completed orders
* Confirmation-aware cancellation
* Ambiguous product/customer resolution
* Authoritative order status returned from the database

### 💰 Expense Management

* Create expenses
* Update expenses
* Delete expenses
* Expense summaries
* Monthly expense overview
* AI-powered expense operations

### 📈 Sales & Business Overview

* Sales overview
* Business performance information
* Expense summary
* Top-product information
* Business-level operational data

### 💬 AI Chat History

The AI assistant includes persistent conversation history inspired by modern AI chat applications.

* New chat
* Conversation history
* Conversation search
* Conversation selection
* Conversation deletion
* Persistent messages
* Edit user messages
* Regenerate AI responses
* Copy responses
* Responsive history sidebar
* Mobile history drawer

### 🎙️ Voice Interaction

* Voice input support in the AI assistant
* Responsive voice controls
* Voice functionality integrated into the chat composer

### 🖼️ Image Upload

* Product image upload
* Product image storage through Supabase Storage
* Inline image display
* Image upload available through the AI chat composer

### 🌐 Language Support

The application supports:

* English
* Roman Urdu

The interface and AI interaction can follow the selected application language.

### 🌓 Theme Support

* Dark theme
* Light theme
* Consistent design tokens
* Responsive premium UI
* Reduced-motion support for animations

### 📱 Responsive Interface

The application is designed for:

* Mobile
* Tablet
* Laptop
* Desktop

The responsive layout includes adaptive navigation, dashboard layouts, AI chat controls, mobile drawers, and responsive content areas.

---

# 🧠 Agentic AI Architecture

AI Business Manager is **not designed as a simple chatbot**.

The assistant operates through an agentic architecture where the model can reason about business requests and use controlled tools to interact with business data.

The high-level flow is:

```text
User
  │
  ▼
AI Business Manager Chat
  │
  ▼
OpenAI Agents SDK
  │
  ▼
Model Provider Layer
  │
  ├── OpenAI (Primary)
  │
  ├── Gemini (Secondary / Failover)
  │
  └── Groq (Final Backup)
  │
  ▼
Business Tools
  │
  ├── Products
  ├── Inventory
  ├── Customers
  ├── Orders
  ├── Expenses
  └── Business Data
  │
  ▼
Supabase / PostgreSQL
  │
  ▼
Authoritative Result
  │
  ▼
AI Response
```

The orchestration layer is based on the **OpenAI Agents SDK**.

Gemini is the primary model provider, with a server-side provider/key routing and failover layer. Multiple legitimately separate Gemini project/API-key slots can be used for applicable provider errors or quota exhaustion, while keys belonging to the same Google project are not treated as independent quotas.

Groq acts as the final backup provider when the available Gemini pool is exhausted or unavailable.

---

# 🔐 Business Data & Security

The application uses **Supabase** for authentication, database storage, and product image storage.

Security-related architecture includes:

* Supabase Authentication
* Google OAuth
* Email authentication
* Protected application routes
* Server-side session handling
* PostgreSQL Row Level Security
* Business ownership checks
* Business-scoped data access
* Authenticated database operations
* Controlled AI business tools

Business records are associated with their owning business, preventing users from intentionally accessing unrelated business data through normal application operations.

---

# 🏗️ Technology Stack

## Frontend

* Next.js
* React
* TypeScript
* Tailwind CSS
* Framer Motion

## Backend & Data

* Next.js App Router
* Supabase
* PostgreSQL
* Supabase Storage
* Row Level Security

## AI

* OpenAI Agents SDK — orchestration
* Google Gemini — primary model provider
* Groq — final backup provider

## Authentication

* Supabase Auth
* Google OAuth
* Email authentication
* SSR session handling

---

# 🗂️ Core Application Structure

The application is organized around the following major areas:

```text
/
├── Homepage
├── Login
├── Business Setup
│
└── Dashboard
    ├── Overview
    ├── Products
    ├── Inventory
    ├── Customers
    ├── Orders
    ├── Expenses
    ├── Sales
    ├── AI Assistant
    └── Settings
```

---

# 🔄 Business Setup

First-time users go through a business setup flow before accessing the main dashboard.

Business setup includes:

* Business name
* Business type
* Currency
* Application language

The application supports multiple business types and currencies, with PKR available as a primary option.

The onboarding flow is protected so users cannot simply bypass required setup.

---

# 🛡️ AI Safety & Data Integrity

Because the assistant can interact with real business data, the application uses controlled tools instead of allowing the model to directly manipulate the database.

Important safeguards include:

### Ambiguous Records

If multiple records match a user's request, the assistant can ask for clarification instead of silently selecting an arbitrary record.

For example:

```text
User:
"Test Dup ka stock batao"

AI:
"Do products mile hain:
1. Test Dup — Clothing
2. Test Dup — Fashion

Kis product ki details chahiye?"
```

### Explicit Record Targeting

Where appropriate, resolved record IDs are passed to business tools so the final operation targets the intended record rather than relying on another fuzzy name search.

### Confirmation

Destructive actions such as deleting records are confirmation-aware.

### Authoritative Results

The assistant is instructed to use actual tool/database results when describing the outcome of business operations rather than assuming that an operation succeeded.

---

# 📦 Order & Inventory Integrity

Order processing contains additional protections for inventory-sensitive operations.

When an order is created as completed:

1. Products are validated.
2. Current inventory is checked.
3. Inventory rows are locked where required.
4. Stock availability is verified.
5. The order is created.
6. Order items are created.
7. Stock is deducted.
8. The order records the stock application state.

The completed-order creation path is designed to avoid leaving a completed order behind when required inventory is unavailable.

Normal order creation defaults to a pending order unless completion is explicitly requested and supported by the operation.

---

# 🎨 UI / UX

The application follows a custom premium design system rather than relying on a component-library-driven visual identity.

Design characteristics include:

* Dark-first interface
* Black / obsidian surfaces
* Emerald accent color
* Off-white typography
* Responsive layouts
* Custom Tailwind components
* Framer Motion animations
* Subtle hover and elevation effects
* Responsive mobile drawers
* Premium AI chat interface
* Accessible focus states
* Reduced-motion support

The public homepage includes a responsive hero section with a floating AI Business Manager smartphone preview.

---

# ⚡ Performance

The application uses several performance-oriented patterns:

* Next.js App Router
* Static rendering where appropriate
* Client-side navigation
* Next.js route prefetching
* Dynamic loading for heavy UI modules
* Framer Motion package optimization
* Parallelized dashboard data requests
* Limited database selections
* Bounded queries
* Cached authentication/session lookups
* Responsive rendering

Heavy product-management dialogs are dynamically loaded so they do not unnecessarily increase the initial product page bundle.

---

# 🧪 Validation & Quality

The project has been validated through development and QA work covering:

* TypeScript type checking
* ESLint
* Production builds
* AI tool tests
* Business operation flows
* Product operations
* Customer operations
* Order operations
* Expense operations
* Sales/business overview
* Chat functionality
* Responsive UI behavior
* Ambiguous entity resolution
* Inventory-sensitive order operations

The existing AI tools test suite currently validates:

```text
52/52 tests passing
```

Additional targeted disambiguation tests were also added during development to verify stale disambiguation state handling.

---

# 🚀 Getting Started

## Prerequisites

Make sure you have installed:

* Node.js
* npm
* A Supabase project
* Required AI provider credentials

## Installation

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/ai-business-manager.git
```

Enter the project directory:

```bash
cd ai-business-manager
```

Install dependencies:

```bash
npm install
```

---

# 🔑 Environment Variables

Create a local environment file:

```text
.env.local
```

Configure the required Supabase and AI provider environment variables used by the application.

**Never commit `.env.local` or API keys to GitHub.**

The actual environment variable values should remain private.

---

# 💻 Development

Start the development server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3001
```

---

# 🏭 Production Build

Create a production build:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

---

# 📁 Project Development Principles

The project follows several important principles:

### No Fabricated Business Data

The AI should not invent products, customers, orders, expenses, stock levels, or financial results.

### Tool-Based Operations

Business-changing operations are performed through controlled tools.

### Database as Source of Truth

When a business operation changes data, the authoritative database/tool result determines what the assistant should report.

### Business-Scoped Access

Business data is scoped to the authenticated user's business.

### Explicit Ambiguity Handling

The assistant should clarify ambiguous records rather than silently selecting the wrong entity.

### Minimal UI Complexity

The interface is designed to remain approachable for both technical and non-technical business users.

---

# 🗺️ Project Status

AI Business Manager has a completed core business-management experience including:

* Authentication
* Business onboarding
* Dashboard
* Products
* Inventory
* Customers
* Orders
* Expenses
* Sales/business overview
* AI business assistant
* Persistent chat history
* Voice interaction
* Product image uploads
* English and Roman Urdu support
* Responsive UI
* Dark/light themes
* Agentic AI tooling
* Business-data safety mechanisms

The project can continue to evolve with additional integrations, automation capabilities, analytics, and business workflows.

---

# 👨‍💻 Author

**Daniyal**

AI Business Manager was designed and developed as a full-stack AI-powered business management application, combining modern web development, business data management, and agentic AI workflows.

---

## 📄 License

This project is currently maintained as a personal/project application.

License information can be added here when the project is released under a specific open-source license.
