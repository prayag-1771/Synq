import { apiService } from './apiService';
import { LocalMessage } from '../db/localDb';

class AiService {
  /**
   * Generates a summary for a given block of messages
   */
  async generateSummary(messages: LocalMessage[]): Promise<string> {
    if (!messages || messages.length === 0) return 'No messages to summarize.';

    // Format the decrypted messages into a transcript string
    const transcript = messages
      .map(m => `${m.senderName}: ${m.content}`)
      .join('\n');

    try {
      const res = await apiService.post('/ai/summarize', { transcript });
      if (!res.ok) throw new Error('Failed to generate summary');
      const data = await res.json();
      return data.summary;
    } catch (error) {
      console.error('AI Summary Error:', error);
      return 'Could not generate summary at this time.';
    }
  }

  /**
   * Suggests 3 smart replies based on recent conversation context
   */
  async getSmartReplies(recentMessages: LocalMessage[]): Promise<string[]> {
    if (!recentMessages || recentMessages.length === 0) return [];

    const contextMessages = recentMessages.map(m => ({
      sender: m.senderName,
      text: m.content
    }));

    try {
      const res = await apiService.post('/ai/replies', { contextMessages });
      if (!res.ok) throw new Error('Failed to generate smart replies');
      const data = await res.json();
      return data.replies || [];
    } catch (error) {
      console.error('AI Smart Replies Error:', error);
      return [];
    }
  }
}

export const aiService = new AiService();
export default aiService;
