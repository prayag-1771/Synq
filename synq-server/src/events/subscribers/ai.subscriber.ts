import { eventBus } from '../eventBus';
import { prisma } from '../../db/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

export const initAISubscriber = () => {
  // Listen for new messages to generate semantic search embeddings
  eventBus.subscribe('message.created', async (data) => {
    try {
      // 1. Fetch the actual message content from the database
      const message = await prisma.message.findUnique({
        where: { id: data.messageId },
        select: { id: true, content: true }
      });

      if (!message || !message.content) return;

      // 2. Skip embedding if no Gemini API key is configured
      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
        console.log('[AI Subscriber] Skipped embedding generation: GEMINI_API_KEY missing.');
        return;
      }

      // 3. Generate 768-dimensional vector embedding using Gemini
      const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const result = await model.embedContent(message.content);
      const embeddingArray = result.embedding.values;

      // 4. Save embedding to database using raw SQL (Prisma Unsupported type)
      // pgvector requires array formatting like '[0.1, 0.2, ...]'
      const vectorString = `[${embeddingArray.join(',')}]`;

      await prisma.$executeRawUnsafe(`
        INSERT INTO "MessageEmbedding" ("id", "messageId", "vector", "createdAt")
        VALUES (gen_random_uuid(), $1, $2::vector, NOW())
        ON CONFLICT ("messageId") DO NOTHING;
      `, message.id, vectorString);

      console.log(`[AI Subscriber] Generated and saved vector embedding for message ${message.id}`);
    } catch (error) {
      console.error(`[AI Subscriber] Failed to process embedding for message ${data.messageId}:`, error);
    }
  });
};
