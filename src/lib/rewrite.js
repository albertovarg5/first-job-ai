// One entry point for rewriting experience text, used by the Experience
// Translator and the Resume Builder. Uses AI when it is connected and turned
// on; otherwise (or if the AI call fails) uses the rule-based Basic mode.
import { callAi } from './ai.js';
import { translateExperience, improvementPrompts } from './translator.js';

export async function rewriteExperience(text, category, aiActive) {
  if (aiActive) {
    try {
      const result = await callAi('translate', { text, category });
      return {
        mode: 'ai',
        bullets: result.bullets.map((b) => b.trim()).filter(Boolean),
        prompts: improvementPrompts(text, category),
      };
    } catch (err) {
      const basic = translateExperience(text, category);
      return { ...basic, mode: 'basic', fallbackReason: err.message };
    }
  }
  return { ...translateExperience(text, category), mode: 'basic' };
}
