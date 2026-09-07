# Synq — AI-Native Secure Messaging & Collaboration Platform

Synq is an elite, production-grade secure messaging and collaboration platform. It moves beyond traditional chat applications by introducing an offline-first architecture, military-grade end-to-end encryption, real-time distributed document editing, and a deeply integrated autonomous AI agent.

This repository houses both the backend API server (`synq-server`), the Next.js client (`synq-web`), and the Tauri Desktop application.

---

## ✨ Core Pillars & Feature

### 🔒 Military-Grade Security
- **Hybrid End-to-End Encryption (E2EE)**: Direct messages are strictly encrypted on your local machine using `libsodium` Curve25519 cryptography before transmission. The server database only stores unreadable ciphertext.
- **AI Bypass System**: Slash commands (like `/agent` or `/todo`) gracefully bypass local encryption to allow server-side LLM processing without compromising standard human-to-human privacy.

### 🐙 GitHub-Native Developer Conversation
- **Live References**: Type `#412`, `@a1b2c3d` or `src/db/redis.ts:40-58` and it resolves into a real card — pull request state, CI status, diff size, review status, or the actual lines of code with line numbers. Paste any GitHub URL and it unfurls the same way.
- **Act Without Leaving the Chat**: Open a pull request from a reference and approve it, request changes, comment, or squash/merge it. Close issues. Quote any diff line straight back into the conversation.
- **Change Code From the Conversation**: Open a repository file, edit it by hand *or* describe the change in English and let the AI propose it, then commit to a branch or open a pull request — without switching tabs.
- **AI That Reads the Diff**: `/review 412` runs a real code review over the actual unified diff and returns severity-ranked findings that can be posted back to GitHub as a review. `/gh <question>` answers questions by searching and reading the repository's real files, citing every path it used.
- **Discussion → Issue**: Turn a chat thread into a well-formed GitHub issue with context, problem, approach and acceptance criteria, drafted from what was actually said.
- **Live Repository Activity**: A repository webhook streams pull requests, pushes, reviews and CI results into the conversation as they happen.
- **Privacy Preserved**: Direct messages stay end-to-end encrypted. Reference parsing runs *in the browser* — only the extracted tokens (`owner/repo#123`) ever reach the server, never your message text.

### 📝 Real-Time Collaborative Canvas (CRDTs)
- **Local-First Synchronization**: Open the "Shared Canvas" in any direct message room to co-edit a rich text document in real-time.
- **E2EE CRDTs**: Powered by `Yjs` and `Tiptap`, every keystroke and cursor movement is End-to-End Encrypted before being broadcasted over the WebSockets. The server blindly routes the ciphertext, ensuring absolute privacy for your collaborative notes.

### 🤖 Autonomous AI & Memory
- **Semantic Memory Engine**: Replaces traditional keyword search with `pgvector` and Gemini Embeddings for mathematically accurate meaning-based search.
- **Desktop File Retrieval**: Through the Tauri Desktop app, the AI can securely scan your local file system to answer questions about your local documents.
- **AI Slash Commands**: Type `/explain`, `/translate`, `/summarize`, or `/todo` in the chat to instantly run complex LLM tasks locally.
- **n8n Automation Integration**: Background workers silently analyze your conversations for action items, extracting them and triggering downstream n8n Webhooks automatically.

### ⚡ Lightning Fast Architecture
- **WebRTC Video Calling**: Native peer-to-peer video calls integrated directly into the chat interface.
- **Real-time Engine**: Sub-millisecond message delivery using WebSockets (Socket.IO).
- **Offline-First Storage**: Native integration with Dexie (IndexedDB) and SQLite ensures the desktop app feels incredibly fast.

---

## 🛠️ Tech Stack

### Frontend (`synq-web` / Tauri Desktop)
- **Framework**: Next.js 16 (Turbopack), React 19, Tauri (Rust)
- **Styling**: Tailwind CSS v4 & custom dark-theme glassmorphism transitions
- **Cryptography**: `libsodium-wrappers`
- **Collaboration**: `yjs`, `y-protocols`, `@tiptap/react`
- **Sockets**: Socket.IO Client
- **State Management**: Zustand

### Backend (`synq-server`)
- **Runtime**: Node.js, Express, TypeScript
- **Database**: Neon PostgreSQL with `pgvector` extension
- **AI Models**: Google Gemini `1.5-flash` (Reasoning & Agents) and `text-embedding-004` (Semantic Search)
- **ORM**: Prisma Client
- **Authentication**: JWT & Bcrypt password hashing
- **Real-time Engine**: Socket.IO & Node EventEmitter

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://www.rust-lang.org/tools/install) (Only required if building the Tauri Desktop App)

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

# GitHub integration
FRONTEND_URL="http://localhost:3000"

# Only needed for live repository activity (webhooks). Must be an HTTPS URL
# GitHub can reach — use an ngrok/Cloudflare tunnel when running locally.
PUBLIC_SERVER_URL=""

# Optional: register a GitHub OAuth App for one-click "Continue with GitHub".
# Without these, users connect with a personal access token instead.
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
```

See [`synq-server/.env.example`](synq-server/.env.example) for every supported variable.

### Step 3: Run Database Migrations

Generate client models and initialize the database tables on your Neon PostgreSQL instance:

```bash
cd synq-server
npx prisma db push
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

*(Note: To run the desktop app, navigate to `synq-web` and run `npm run tauri dev`)*

---

## 🐙 Using GitHub in Synq

### Connect and link

1. Open any conversation and click the **GitHub** icon in the header.
2. **Connect** with a [personal access token](https://github.com/settings/tokens/new?scopes=repo,read:org,read:user&description=Synq%20Integration) carrying the `repo` scope (or use OAuth if the server has `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` set).
3. **Link a repository** to the conversation. Tick *"Stream live activity"* to install a webhook — this needs admin rights on the repo and `PUBLIC_SERVER_URL` set on the server.

Your token is encrypted with AES-256-GCM before it is stored, and every request runs with *your* GitHub permissions — Synq can never surface something you could not already see.

### Reference syntax

Once a repository is linked, these resolve automatically as you type:

| You type | You get |
| :--- | :--- |
| `#412` | Pull request or issue #412 in the linked repo |
| `owner/repo#412` | The same, in any other repository |
| `@a1b2c3d` | That commit, with its diff and an AI explanation |
| `owner/repo@a1b2c3d` | A commit in another repository |
| `src/db/redis.ts:40-58` | Those exact lines, rendered inline with line numbers |
| any GitHub URL | Unfurls — pull requests, issues, commits, blobs with `#L10-L20`, compares, branches, workflow runs |

Press `#` in the composer to pick from open pull requests and issues without leaving the keyboard. References inside code blocks and backticks are deliberately ignored.

### Slash commands

| Command | What it does |
| :--- | :--- |
| `/pr <number>` | Explains what a pull request changes, read from the real diff |
| `/review <number>` | Full AI code review — severity-ranked findings, postable to GitHub |
| `/commit <sha>` | Explains what a commit actually did |
| `/issue` | Turns the current discussion into a GitHub issue and opens it |
| `/gh <question>` | Answers a question by searching and reading the repository's files |
| `/repo` | Shows which repositories this conversation is linked to |

`/agent` also gains GitHub tools when a repository is linked, so it can list pull requests, read files, search code, open issues and comment on your behalf.

---

## 🤖 Built by AI — Call for Contributors

> **This entire 10-Phase architecture, from the End-to-End Encryption implementation to the Yjs Collaborative Editor and the Tauri Desktop integration, was designed and built by an Autonomous AI Agent!**

Because this project was heavily constructed by artificial intelligence, there may be hidden bugs, architectural optimizations, or features that require human ingenuity. 

If you have knowledge in cryptography, CRDTs, WebSockets, or modern React architectures, **please come and help!** We welcome issues, pull requests, corrections, and new feature building to help take this AI-generated foundation to the absolute next level.
