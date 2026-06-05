import { Request, Response } from 'express';
import Groq from 'groq-sdk';

// Initialize the Groq AI client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy_key' });

export const generateSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { transcript } = req.body;
    
    if (!transcript) {
      res.status(400).json({ error: 'Missing chat transcript' });
      return;
    }

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'dummy_key') {
      res.status(200).json({ summary: "• [MOCK AI] This is a mock summary because GROQ_API_KEY is not set.\n• [MOCK AI] You talked about setting up E2EE and AI." });
      return;
    }

    const prompt = `
    You are a helpful assistant embedded in a secure chat app.
    Summarize the following chat conversation into 2-4 concise bullet points.
    Focus only on the most important information and actionable items.
    Do not include any conversational filler.
    
    Chat Transcript:
    ${transcript}
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.3,
    });

    const text = chatCompletion.choices[0]?.message?.content || 'No summary generated.';

    res.status(200).json({ summary: text });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
};

export const generateSmartReplies = async (req: Request, res: Response): Promise<void> => {
  try {
    const { contextMessages } = req.body; // array of recent messages
    
    if (!contextMessages || !Array.isArray(contextMessages)) {
      res.status(400).json({ error: 'Missing context messages' });
      return;
    }

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'dummy_key') {
      res.status(200).json({ replies: ["Sounds good!", "No problem", "I'll check on that."] });
      return;
    }

    const prompt = `
    You are a smart reply engine for a chat app.
    Based on the following recent messages, generate EXACTLY 3 short, context-aware reply suggestions for the user.
    The replies should be natural, brief (1-5 words), and distinct from each other.
    Format your response EXACTLY as a valid JSON array of 3 strings. NO extra text, NO markdown blocks.
    Example: ["Yes, absolutely", "Not right now", "I will do it"]
    
    Recent Messages Context:
    ${contextMessages.map((m: any) => `${m.sender}: ${m.text}`).join('\n')}
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.5,
    });

    const text = chatCompletion.choices[0]?.message?.content || '[]';
    
    try {
      // Strip markdown code blocks if the model returned them
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const replies = JSON.parse(cleanText);
      res.status(200).json({ replies });
    } catch (parseError) {
      res.status(500).json({ error: 'Failed to parse AI response' });
    }

  } catch (error) {
    console.error('Error generating smart replies:', error);
    res.status(500).json({ error: 'Failed to generate smart replies' });
  }
};

import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../db/db';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

export const semanticSearch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, limit = 5 } = req.query;
    
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query parameter is required' });
      return;
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
      res.status(500).json({ error: 'Semantic search is unavailable. GEMINI_API_KEY is missing.' });
      return;
    }

    // 1. Convert the user's search string into a 768-dimensional vector
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(query);
    const embeddingArray = result.embedding.values;
    const vectorString = `[${embeddingArray.join(',')}]`;

    // 2. Perform Cosine Similarity search (<=>) on the MessageEmbedding table
    // We only want to search messages from chats the user is actually a participant in!
    // @ts-ignore
    const userId = req.user.userId;

    const matches: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        m.id, 
        m.content, 
        m."createdAt", 
        m."chatId", 
        m."senderId",
        u.username as "senderName",
        u.avatar as "senderAvatar",
        1 - (e.vector <=> $1::vector) as similarity
      FROM "MessageEmbedding" e
      JOIN "Message" m ON m.id = e."messageId"
      JOIN "User" u ON u.id = m."senderId"
      JOIN "ChatParticipant" cp ON cp."chatId" = m."chatId" AND cp."userId" = $2
      ORDER BY e.vector <=> $1::vector
      LIMIT $3;
    `, vectorString, userId, parseInt(limit as string));

    res.status(200).json({ 
      query,
      results: matches.map(match => ({
        id: match.id,
        content: match.content,
        chatId: match.chatId,
        senderId: match.senderId,
        senderName: match.senderName,
        senderAvatar: match.senderAvatar,
        createdAt: match.createdAt,
        confidence: match.similarity
      }))
    });
  } catch (error) {
    console.error('Semantic search error:', error);
    res.status(500).json({ error: 'Failed to perform semantic search' });
  }
};

export const translateText = async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, targetLanguage } = req.body;
    if (!text || !targetLanguage) {
      res.status(400).json({ error: 'Text and targetLanguage are required' });
      return;
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
      res.status(200).json({ translation: `[MOCK TRANSLATION to ${targetLanguage}]: ${text}` });
      return;
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Translate the following text to ${targetLanguage}. Provide ONLY the translation, no extra conversational text.\n\nText: ${text}`;
    
    const result = await model.generateContent(prompt);
    const translation = result.response.text().trim();

    res.status(200).json({ translation });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: 'Failed to translate text' });
  }
};

export const explainContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
      res.status(200).json({ explanation: `[MOCK EXPLANATION] This looks like a technical concept related to: ${text.substring(0,20)}...` });
      return;
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are a helpful engineering assistant. Explain the following concept, code, or term simply and concisely.\n\nContext: ${text}`;
    
    const result = await model.generateContent(prompt);
    const explanation = result.response.text().trim();

    res.status(200).json({ explanation });
  } catch (error) {
    console.error('Explanation error:', error);
    res.status(500).json({ error: 'Failed to explain context' });
  }
};

export const extractTodos = async (req: Request, res: Response): Promise<void> => {
  try {
    const { chatId } = req.query;
    if (!chatId || typeof chatId !== 'string') {
      res.status(400).json({ error: 'chatId is required' });
      return;
    }

    const tasks = await prisma.extractedTask.findMany({
      where: {
        chatId,
        isCompleted: false
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (tasks.length === 0) {
      res.status(200).json({ todos: '*No pending tasks or meetings found in this chat.*' });
      return;
    }

    let response = `**Action Items & Meetings**\n\n`;
    
    tasks.forEach((t) => {
      const typeIcon = t.type === 'MEETING' ? '📅' : '✅';
      const dueStr = t.dueDate ? ` *(Due: ${t.dueDate.toLocaleDateString()})*` : '';
      response += `${typeIcon} **[${t.type}]** ${t.title}${dueStr}\n`;
    });

    res.status(200).json({ todos: response });
  } catch (error) {
    console.error('Todo extraction error:', error);
    res.status(500).json({ error: 'Failed to extract todos' });
  }
};

import { executeAgentPrompt } from '../services/agent.service';

export const runAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, chatId } = req.body;
    if (!prompt || !chatId) {
      res.status(400).json({ error: 'Prompt and chatId are required' });
      return;
    }

    // @ts-ignore
    const userId = req.user.userId;

    const response = await executeAgentPrompt(prompt, chatId, userId);
    res.status(200).json({ response });
  } catch (error) {
    console.error('Agent runner error:', error);
    res.status(500).json({ error: 'Failed to run agent' });
  }
};
