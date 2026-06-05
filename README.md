# Synq — AI-Native Secure Messaging & Collaboration Platform

Synq is a modern, production-grade, secure, and real-time messaging and collaboration platform designed with an offline-first architecture and native AI assistance.

This repository houses both the backend API server (`synq-server`) and the Next.js client (`synq-web`).

---

## ✨ Core Pillars & Features

- **⚡ Fast & Real-time**: Sub-millisecond message delivery using WebSockets (Socket.IO) and an Event-Driven backend architecture.
- **🧠 Semantic Memory Engine**: Replaces traditional keyword search with `pgvector` and Gemini Embeddings for mathematically accurate meaning-based search.
- **🤖 Autonomous AI Agent**: Built-in ReAct Agent powered by Gemini Native Function Calling. Use `/agent` to have the AI search your history and execute tasks for you.
- **⚡ AI Slash Commands**: Type `/explain`, `/translate`, `/summarize`, or `/todo` in the chat to instantly run complex LLM tasks locally.
- **⚙️ n8n Automation Integration**: Background workers silently analyze your conversations for action items and meetings, extracting them and triggering downstream n8n Webhooks automatically.
- **🔒 Secure First**: JWT access/refresh tokens with a hardened security model.

---

## 🛠️ Tech Stack

### Frontend (`synq-web`)
- **Framework**: Next.js 16 (Turbopack) & React 19
- **Styling**: Tailwind CSS v4 & custom dark-theme glassmorphism transitions
- **Icons**: Lucide React
- **State Management**: Zustand (with persistent local storage integration)
- **Sockets**: Socket.IO Client

### Backend (`synq-server`)
- **Runtime**: Node.js, Express, TypeScript
- **Database**: Neon PostgreSQL with `pgvector` extension
- **AI Models**: Google Gemini `1.5-flash` (Reasoning & Agents) and `text-embedding-004` (Semantic Search)
- **ORM**: Prisma Client
- **Authentication**: JWT (JSON Web Tokens) with auto-rotating refresh tokens and Bcrypt password hashing
- **Real-time Engine**: Socket.IO & Node EventEmitter
- **Automation**: Outbound HTTP Webhooks mapped to n8n pipelines

---

## 📂 Project Structure

```text
Synq/
├── docker-compose.yml       # Local PostgreSQL & Redis developer setup
├── README.md                # Project documentation
├── synq-server/             # Backend API & WebSocket Server
│   ├── prisma/              # Database schemas & migrations
│   ├── src/
│   │   ├── controllers/     # Authentication & Chat routing logic
│   │   ├── db/              # Prisma DB Client wrapper
│   │   ├── middleware/      # JWT protection middleware
│   │   ├── routes/          # Express route definitions
│   │   ├── sockets/         # WebSocket room & event managers
│   │   └── server.ts        # App bootstrap entry point
│   ├── tsconfig.json
│   └── package.json
└── synq-web/                # Next.js Frontend App Router Client
    ├── public/              # Static UI assets
    ├── src/
    │   ├── app/             # App Router pages (Chat workspace, Login, Register)
    │   ├── services/        # HTTP API Client & Socket lifecycle services
    │   ├── stores/          # Zustand State Stores (Auth, Chat logs)
    │   └── types/
    └── package.json
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Optional - only if running database locally instead of using Neon cloud database)

---

### Step 1: Clone and Install Dependencies

```bash
# Install backend packages
cd synq-server
npm install

# Install frontend packages
cd ../synq-web
npm install
```

### Step 2: Configure Environment Secrets

Create a `.env` file in the `synq-server/` directory:

```env
PORT=5000
DATABASE_URL="YOUR_NEON_POSTGRESQL_CONNECTION_URL"
JWT_SECRET="generate-a-secure-random-key-here"
JWT_REFRESH_SECRET="generate-another-secure-random-key-here"
GEMINI_API_KEY="your-google-gemini-api-key"
N8N_WEBHOOK_URL="optional-webhook-url-for-automation"
```

### Step 3: Run Database Migrations

Generate client models and initialize the database tables on your Neon PostgreSQL instance:

```bash
cd synq-server
npx prisma migrate dev --name init
```

### Step 4: Run the Services

Open two terminals to run both the backend and frontend servers:

```bash
# In terminal 1: Start Backend API (runs on http://localhost:5000)
cd synq-server
npm run dev

# In terminal 2: Start Frontend Client (runs on http://localhost:3000)
cd synq-web
npm run dev
```

---

## 🧪 Verification & Manual Testing Flow

1. Open `http://localhost:3000` in a browser window (redirects to `/login`).
2. Register an account for `alice` (e.g. `alice`, `alice@synq.app`, password: `Password123`).
3. Open an Incognito window and register an account for `bob`.
4. In Alice's panel, search for "bob" in the contacts list, and click Bob's name to start a direct message thread.
5. Confirm that typing a message in Bob's client updates Alice's timeline header with a `Bob is typing...` indicator in real-time.
6. Send messages back and forth and see them pop up instantly on both screens via WebSockets.
