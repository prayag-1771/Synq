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

  /**
   * Performs a vector similarity search using pgvector on the backend
   */
  async semanticSearch(query: string, limit = 5): Promise<any[]> {
    if (!query) return [];

    try {
      const res = await apiService.get(`/ai/search?query=${encodeURIComponent(query)}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to perform semantic search');
      const data = await res.json();
      return data.results || [];
    } catch (error) {
      console.error('AI Semantic Search Error:', error);
      return [];
    }
  }
  /**
   * Translates text to a target language
   */
  async translateText(text: string, targetLanguage: string): Promise<string> {
    try {
      const res = await apiService.post('/ai/translate', { text, targetLanguage });
      if (!res.ok) throw new Error('Failed to translate');
      const data = await res.json();
      return data.translation || '';
    } catch (error) {
      console.error('AI Translation Error:', error);
      return 'Sorry, I could not translate that right now.';
    }
  }

  /**
   * Explains a technical concept or block of code
   */
  async explainContext(text: string): Promise<string> {
    try {
      const res = await apiService.post('/ai/explain', { text });
      if (!res.ok) throw new Error('Failed to explain');
      const data = await res.json();
      return data.explanation || '';
    } catch (error) {
      console.error('AI Explanation Error:', error);
      return 'Sorry, I could not generate an explanation right now.';
    }
  }

  /**
   * Extracts tasks/todos from the current channel context
   */
  async extractTodos(chatId: string): Promise<string> {
    try {
      const res = await apiService.get(`/ai/todo?chatId=${chatId}`);
      if (!res.ok) throw new Error('Failed to extract todos');
      const data = await res.json();
      return data.todos || '';
    } catch (error) {
      console.error('AI Todo Error:', error);
      return 'Sorry, I could not extract tasks right now.';
    }
  }
  /**
   * Runs the autonomous Agent with the given prompt
   */
  async runAgent(prompt: string, chatId: string): Promise<string> {
    try {
      const res = await apiService.post('/ai/agent', { prompt, chatId });
      if (!res.ok) throw new Error('Failed to run agent');
      const data = await res.json();
      
      // Check if the backend agent paused execution to request a client-side tool execution
      if (data.clientActionRequired) {
        if (data.clientActionRequired === 'searchLocalFiles') {
          let toolResult = [];
          try {
            // @ts-ignore
            if (typeof window !== 'undefined' && window.__TAURI__) {
              const { invoke } = await import('@tauri-apps/api/core');
              console.log('[AI Service] Executing Tauri Rust command: search_local_files');
              toolResult = await invoke('search_local_files', { 
                query: data.args.query, 
                ext: data.args.ext 
              }) as any[];
            } else {
              toolResult = ['Error: Cannot search local files. App is not running in Tauri Desktop environment.'];
            }
          } catch (e) {
            console.error('[AI Service] Tauri invoke failed:', e);
            toolResult = ['Error: Failed to execute local file search.'];
          }

          // Resume the agent with the tool results
          const resumeRes = await apiService.post('/ai/agent/resume', {
            history: data.history,
            toolName: 'searchLocalFiles',
            toolResult
          });
          
          if (!resumeRes.ok) throw new Error('Failed to resume agent');
          const resumeData = await resumeRes.json();
          return resumeData.response || '';
        }
      }

      return data.response || '';
    } catch (error) {
      console.error('Agent Error:', error);
      return 'Sorry, the agent encountered an error processing your request.';
    }
  }
}

export const aiService = new AiService();
export default aiService;
