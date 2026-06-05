import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { prisma } from '../db/db';

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

export const executeAgentPrompt = async (prompt: string, chatId: string, userId: string): Promise<any> => {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
    return { response: 'Agent is offline. GEMINI_API_KEY is not configured.' };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // Initialize the model with our custom tools
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    tools: [
      {
        functionDeclarations: [searchMessagesDeclaration, createTaskDeclaration, searchLocalFilesDeclaration],
      },
    ],
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
