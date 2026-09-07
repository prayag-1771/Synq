import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { prisma } from '../db/db';
import { GitHubClient } from './github.service';
import { decryptSecret } from '../utils/crypto.util';
import { summarizePullRequest, reviewPullRequest } from './github-ai.service';

const searchMessagesDeclaration: FunctionDeclaration = {
  name: 'searchMessages',
  description: "Search the user's past chat history using semantic vector search. Use this when the user asks to find, recall, or search for something discussed previously.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: {
        type: SchemaType.STRING,
        description: 'The semantic meaning or exact phrase to search for.',
      },
    },
    required: ['query'],
  },
};

const createTaskDeclaration: FunctionDeclaration = {
  name: 'createTask',
  description: "Creates a new task, action item, or meeting in the database. This automatically triggers downstream automations. Use this when the user asks to schedule something, add a todo, or save a reminder.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      title: {
        type: SchemaType.STRING,
        description: 'The title or description of the task.',
      },
      type: {
        type: SchemaType.STRING,
        description: "The type of task. Must be either 'TODO' or 'MEETING'.",
      },
      dueDate: {
        type: SchemaType.STRING,
        description: 'Optional ISO 8601 date string if a deadline or specific time is mentioned.',
      },
    },
    required: ['title', 'type'],
  },
};

const searchLocalFilesDeclaration: FunctionDeclaration = {
  name: 'searchLocalFiles',
  description: "Searches the user's local computer for files. Use this ONLY when the user explicitly asks to find a file, document, image, or spreadsheet on their local hard drive.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'The filename or keyword to search for.' },
      ext: { type: SchemaType.STRING, description: 'Optional file extension (e.g. .pdf, .xlsx).' }
    },
    required: ['query'],
  },
};

// --- GitHub tools ----------------------------------------------------------
// Available only when a repository is linked to the conversation.

const listPullRequestsDeclaration: FunctionDeclaration = {
  name: 'listPullRequests',
  description: 'Lists pull requests in the repository linked to this conversation. Use for questions like "what is open?", "what needs review?", "did anything land today?".',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      state: { type: SchemaType.STRING, description: "One of 'open', 'closed' or 'all'. Defaults to 'open'." },
    },
    required: [],
  },
};

const getPullRequestDeclaration: FunctionDeclaration = {
  name: 'getPullRequest',
  description: 'Fetches the full detail of one pull request — title, state, author, branches, size, CI status and description.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      number: { type: SchemaType.NUMBER, description: 'The pull request number.' },
    },
    required: ['number'],
  },
};

const summarizePullRequestDeclaration: FunctionDeclaration = {
  name: 'summarizePullRequest',
  description: 'Reads the actual diff of a pull request and explains what changed and why. Use when asked what a PR does.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      number: { type: SchemaType.NUMBER, description: 'The pull request number.' },
    },
    required: ['number'],
  },
};

const reviewPullRequestDeclaration: FunctionDeclaration = {
  name: 'reviewPullRequest',
  description: 'Runs a full code review over a pull request diff and returns structured findings. Use only when explicitly asked to review or check a PR for problems.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      number: { type: SchemaType.NUMBER, description: 'The pull request number.' },
    },
    required: ['number'],
  },
};

const readRepoFileDeclaration: FunctionDeclaration = {
  name: 'readRepoFile',
  description: 'Reads a file from the linked repository so you can answer questions about the real code.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Path from the repository root, e.g. src/services/socket.ts' },
      ref: { type: SchemaType.STRING, description: 'Optional branch, tag or commit sha. Defaults to the default branch.' },
    },
    required: ['path'],
  },
};

const searchRepoCodeDeclaration: FunctionDeclaration = {
  name: 'searchRepoCode',
  description: 'Searches the linked repository for code matching a keyword, returning matching file paths. Use to locate where something is implemented.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Identifier or keyword to search for in the code.' },
    },
    required: ['query'],
  },
};

const createGithubIssueDeclaration: FunctionDeclaration = {
  name: 'createGithubIssue',
  description: 'Opens a new GitHub issue in the linked repository. Use when the user asks to file, open, or create an issue or bug report.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      title: { type: SchemaType.STRING, description: 'A specific, imperative issue title.' },
      body: { type: SchemaType.STRING, description: 'Markdown body with context, problem and acceptance criteria.' },
      labels: { type: SchemaType.STRING, description: 'Optional comma-separated labels, e.g. "bug,backend".' },
    },
    required: ['title'],
  },
};

const commentOnGithubDeclaration: FunctionDeclaration = {
  name: 'commentOnGithub',
  description: 'Posts a comment on a pull request or issue in the linked repository. Use when the user asks to reply, comment, or leave a note on GitHub.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      number: { type: SchemaType.NUMBER, description: 'The pull request or issue number.' },
      body: { type: SchemaType.STRING, description: 'The comment text in markdown.' },
    },
    required: ['number', 'body'],
  },
};

interface RepoContext {
  client: GitHubClient;
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
}

/**
 * Resolves the repository the agent should act on: the primary repo linked to
 * this conversation, accessed with the calling user's own GitHub token.
 */
const getRepoContext = async (chatId: string, userId: string): Promise<RepoContext | null> => {
  const [account, link] = await Promise.all([
    prisma.gitHubAccount.findUnique({ where: { userId } }),
    prisma.chatRepository.findFirst({
      where: { chatId },
      include: { repository: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    }),
  ]);

  if (!account || !link) return null;

  try {
    return {
      client: new GitHubClient(decryptSecret(account.accessToken)),
      owner: link.repository.owner,
      repo: link.repository.name,
      fullName: link.repository.fullName,
      defaultBranch: link.repository.defaultBranch,
    };
  } catch {
    return null;
  }
};

export const executeAgentPrompt = async (prompt: string, chatId: string, userId: string): Promise<any> => {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
    return { response: 'Agent is offline. GEMINI_API_KEY is not configured.' };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const repoContext = await getRepoContext(chatId, userId);

  const functionDeclarations: FunctionDeclaration[] = [
    searchMessagesDeclaration,
    createTaskDeclaration,
    searchLocalFilesDeclaration,
  ];

  if (repoContext) {
    functionDeclarations.push(
      listPullRequestsDeclaration,
      getPullRequestDeclaration,
      summarizePullRequestDeclaration,
      reviewPullRequestDeclaration,
      readRepoFileDeclaration,
      searchRepoCodeDeclaration,
      createGithubIssueDeclaration,
      commentOnGithubDeclaration
    );
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    tools: [{ functionDeclarations }],
    systemInstruction: repoContext
      ? `You are Synq's engineering agent, embedded in a developer conversation. The repository linked to this conversation is ${repoContext.fullName} (default branch: ${repoContext.defaultBranch}). When the user says "the repo", "this PR", or gives a bare number, they mean that repository. Use your GitHub tools to work from real data rather than guessing. Answer in concise markdown.`
      : `You are Synq's engineering agent, embedded in a developer conversation. No GitHub repository is linked to this chat yet — if the user asks about pull requests, issues or code, tell them to link a repository from the GitHub panel first. Answer in concise markdown.`,
  });

  const chatSession = model.startChat();

  try {
    // 1. Send the initial prompt to the Agent
    const result = await chatSession.sendMessage(prompt);
    let responseText = result.response.text();
    const functionCalls = result.response.functionCalls();

    // 2. Check if the Agent wants to use a tool
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      let toolResultStr = '';

      if (call.name === 'searchMessages') {
        const { query } = call.args as any;
        console.log(`[Agent] Calling Tool: searchMessages("${query}")`);

        const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const embedRes = await embedModel.embedContent(query);
        const vectorString = `[${embedRes.embedding.values.join(',')}]`;

        const matches: any[] = await prisma.$queryRawUnsafe(`
          SELECT m.content, u.username as "senderName", 1 - (e.vector <=> $1::vector) as similarity
          FROM "MessageEmbedding" e
          JOIN "Message" m ON m.id = e."messageId"
          JOIN "User" u ON u.id = m."senderId"
          JOIN "ChatParticipant" cp ON cp."chatId" = m."chatId" AND cp."userId" = $2
          ORDER BY e.vector <=> $1::vector
          LIMIT 3;
        `, vectorString, userId);

        toolResultStr = JSON.stringify(matches.map(m => `[${m.senderName}]: ${m.content}`));
      }
      else if (call.name === 'createTask') {
        const { title, type, dueDate } = call.args as any;
        console.log(`[Agent] Calling Tool: createTask("${title}")`);

        const savedTask = await prisma.extractedTask.create({
          data: {
            chatId,
            messageId: 'AGENT_GENERATED',
            title,
            type,
            dueDate: dueDate ? new Date(dueDate) : null
          }
        });

        if (process.env.N8N_WEBHOOK_URL) {
          try {
            await fetch(process.env.N8N_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'task.extracted', data: savedTask })
            });
          } catch (e) {}
        }

        toolResultStr = JSON.stringify({ success: true, taskId: savedTask.id, message: 'Task created and dispatched to webhooks.' });
      }
      else if (call.name === 'searchLocalFiles') {
        const { query, ext } = call.args as any;
        console.log(`[Agent] Calling Tool: searchLocalFiles("${query}", "${ext || ''}")`);

        // PAUSE: Return the action requirement to the client
        return {
          clientActionRequired: 'searchLocalFiles',
          args: { query, ext: ext || '' },
          history: await chatSession.getHistory()
        };
      }
      else if (repoContext) {
        toolResultStr = await executeGithubTool(call.name, call.args as any, repoContext);
      }
      else {
        toolResultStr = JSON.stringify({ error: 'No GitHub repository is linked to this conversation.' });
      }

      // 3. Send the tool execution result back to Gemini so it can answer the user
      const finalResult = await chatSession.sendMessage([{
        functionResponse: {
          name: call.name,
          response: { result: toolResultStr }
        }
      }]);

      responseText = finalResult.response.text();
    }

    return { response: responseText.trim() };
  } catch (error) {
    console.error('[Agent] Execution error:', error);
    return { response: 'Sorry, I encountered an error while trying to process your request.' };
  }
};

/**
 * Runs one GitHub tool call against the conversation's linked repository.
 * Failures come back as JSON the model can explain rather than as exceptions.
 */
const executeGithubTool = async (name: string, args: any, ctx: RepoContext): Promise<string> => {
  const { client, owner, repo } = ctx;
  console.log(`[Agent] Calling GitHub Tool: ${name}(${JSON.stringify(args)}) on ${ctx.fullName}`);

  try {
    switch (name) {
      case 'listPullRequests': {
        const pulls = await client.listPullRequests(owner, repo, args.state || 'open', 15);
        return JSON.stringify(
          pulls.map((p: any) => ({
            number: p.number,
            title: p.title,
            state: p.merged_at ? 'merged' : p.state,
            draft: p.draft,
            author: p.user?.login,
            branch: `${p.head?.ref} → ${p.base?.ref}`,
            updatedAt: p.updated_at,
            url: p.html_url,
          }))
        );
      }

      case 'getPullRequest': {
        const pull = await client.getPullRequest(owner, repo, Number(args.number));
        let checks: any = null;
        if (pull.head?.sha) {
          const runs = await client.listCheckRuns(owner, repo, pull.head.sha).catch(() => null);
          checks = (runs?.check_runs || []).map((c: any) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
        }
        return JSON.stringify({
          number: pull.number,
          title: pull.title,
          state: pull.merged ? 'merged' : pull.state,
          draft: pull.draft,
          author: pull.user?.login,
          branch: `${pull.head?.ref} → ${pull.base?.ref}`,
          size: `+${pull.additions}/-${pull.deletions} across ${pull.changed_files} files`,
          mergeable: pull.mergeable,
          body: (pull.body || '').slice(0, 1500),
          checks,
          url: pull.html_url,
        });
      }

      case 'summarizePullRequest': {
        const summary = await summarizePullRequest(client, owner, repo, Number(args.number));
        return JSON.stringify({ summary });
      }

      case 'reviewPullRequest': {
        const review = await reviewPullRequest(client, owner, repo, Number(args.number));
        return JSON.stringify(review);
      }

      case 'readRepoFile': {
        const file = await client.getFileText(owner, repo, String(args.path).replace(/^\/+/, ''), args.ref);
        return JSON.stringify({ path: args.path, content: file.text.slice(0, 15000), url: file.htmlUrl });
      }

      case 'searchRepoCode': {
        const results = await client.searchCode(`${args.query} repo:${owner}/${repo}`, 10);
        return JSON.stringify(
          (results.items || []).map((i: any) => ({ path: i.path, url: i.html_url }))
        );
      }

      case 'createGithubIssue': {
        const labels = typeof args.labels === 'string' && args.labels.trim()
          ? args.labels.split(',').map((l: string) => l.trim()).filter(Boolean)
          : undefined;
        const issue = await client.createIssue(owner, repo, {
          title: String(args.title),
          body: args.body ? String(args.body) : undefined,
          labels,
        });
        return JSON.stringify({ created: true, number: issue.number, title: issue.title, url: issue.html_url });
      }

      case 'commentOnGithub': {
        const comment = await client.createIssueComment(owner, repo, Number(args.number), String(args.body));
        return JSON.stringify({ posted: true, url: comment.html_url });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (error: any) {
    return JSON.stringify({ error: error?.message || 'GitHub tool call failed' });
  }
};

export const resumeAgentPrompt = async (history: any[], toolName: string, toolResult: any): Promise<any> => {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
    return { response: 'Agent is offline. GEMINI_API_KEY is not configured.' };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const chatSession = model.startChat({ history });

  try {
    const finalResult = await chatSession.sendMessage([{
      functionResponse: {
        name: toolName,
        response: { result: JSON.stringify(toolResult) }
      }
    }]);

    return { response: finalResult.response.text().trim() };
  } catch (error) {
    console.error('[Agent Resume] Execution error:', error);
    return { response: 'Sorry, I encountered an error resuming your request.' };
  }
};
