import { eventBus } from '../eventBus';
import { prisma } from '../../db/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

// Fast regex filter to avoid calling the LLM on every "hello" or "lol"
const ACTION_REGEX = /\b(todo|task|meeting|schedule|tomorrow|deploy|fix|bug|review|remind)\b/i;

export const initAutomationSubscriber = () => {
  eventBus.subscribe('message.created', async (data) => {
    try {
      // 1. Fetch message content
      const message = await prisma.message.findUnique({
        where: { id: data.messageId },
        select: { id: true, content: true, chatId: true }
      });

      if (!message || !message.content) return;

      // 2. Regex Check
      if (!ACTION_REGEX.test(message.content)) {
        return; // Skip extraction
      }

      // 3. Skip if no API key
      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
        console.log('[Automation] Skipped extraction: GEMINI_API_KEY missing.');
        return;
      }

      // 4. Extract context using Gemini (Structured Output approach)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `Analyze the following chat message and extract any action items, tasks, or scheduled meetings.
Return ONLY a valid JSON object with the following schema:
{
  "tasks": [
    {
      "title": "Clear description of the task or meeting",
      "type": "TODO" or "MEETING",
      "dueDate": "ISO 8601 string if mentioned, otherwise null"
    }
  ]
}
If no actionable items are found, return { "tasks": [] }.
Do not include markdown blocks like \`\`\`json. Just the raw JSON string.

Message: "${message.content}"`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
      
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        console.error('[Automation] Failed to parse Gemini JSON output:', text);
        return;
      }

      if (!parsed.tasks || parsed.tasks.length === 0) {
        return; // Nothing actionable
      }

      console.log(`[Automation] Extracted ${parsed.tasks.length} tasks from message ${message.id}`);

      // 5. Save to Database & Dispatch to n8n Webhook
      for (const task of parsed.tasks) {
        const savedTask = await prisma.extractedTask.create({
          data: {
            chatId: message.chatId,
            messageId: message.id,
            title: task.title,
            type: task.type,
            dueDate: task.dueDate ? new Date(task.dueDate) : null
          }
        });

        // Fire Webhook to n8n if configured
        if (process.env.N8N_WEBHOOK_URL) {
          try {
            await fetch(process.env.N8N_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'task.extracted',
                data: savedTask
              })
            });
            console.log(`[Automation] Dispatched task ${savedTask.id} to n8n webhook.`);
          } catch (webhookErr) {
            console.error(`[Automation] Failed to dispatch webhook for task ${savedTask.id}:`, webhookErr);
          }
        }
      }
    } catch (error) {
      console.error(`[Automation] Processing error for message ${data.messageId}:`, error);
    }
  });
};
