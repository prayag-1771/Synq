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
