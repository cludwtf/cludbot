// OpenRouter direct API - replaces inference.sh openrouter/claude-sonnet-45
const fetch = globalThis.fetch || require('node-fetch');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

async function chat(prompt, options = {}) {
  const {
    model = 'anthropic/claude-sonnet-4',
    systemPrompt = '',
    maxTokens = 1000,
    temperature = 0.8,
  } = options;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://clud.news',
      'X-Title': 'clud-bot',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = { chat };
