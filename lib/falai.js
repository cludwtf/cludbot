// fal.ai direct API - replaces inference.sh falai/flux-dev
const fetch = globalThis.fetch || require('node-fetch');

async function generateImage(prompt, options = {}) {
  const {
    model = 'fal-ai/flux/dev',
    size = 'square_hd',  // square, square_hd, landscape_4_3, landscape_16_9, portrait_4_3, portrait_16_9
    numImages = 1,
  } = options;

  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY not set');

  // Submit request
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: size,
      num_images: numImages,
      enable_safety_checker: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai ${res.status}: ${err}`);
  }

  const data = await res.json();
  
  // fal.ai queue mode returns request_id, need to poll
  if (data.request_id) {
    return await pollResult(model, data.request_id, apiKey);
  }

  // Direct response
  return data.images?.map(img => img.url) || [];
}

async function pollResult(model, requestId, apiKey, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal.run/${model}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${apiKey}` },
    });
    const status = await res.json();
    
    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(`https://queue.fal.run/${model}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${apiKey}` },
      });
      const result = await resultRes.json();
      return result.images?.map(img => img.url) || [];
    }
    
    if (status.status === 'FAILED') {
      throw new Error(`fal.ai generation failed: ${JSON.stringify(status)}`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('fal.ai generation timed out');
}

module.exports = { generateImage };
