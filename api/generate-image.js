const CONFIG = {
  PROMPT_MODEL: 'xiaomi/mimo-v2-flash:free',
  // OpenRouter image model
  OPENROUTER_IMAGE_MODEL: 'bytedance-seed/seedream-4.5',
  // Replicate model (from env or default)
  REPLICATE_MODEL: process.env.REPLICATE_MODEL || 'prunaai/z-image-turbo',
  STYLE_SUFFIX: ', in the style of Hayao Miyazaki Studio Ghibli anime',
};

// Get which provider to use: "openrouter" or "replicate"
function getImageProvider() {
  return process.env.IMAGE_PROVIDER || 'openrouter';
}

// Generate image prompt from text using LLM
async function generateImagePrompt(text, apiKey, host, guidance = '') {
  let systemPrompt = `You are an image prompt generator. Analyze the given text and create a short, vivid image prompt (max 80 words) that illustrates the last few sentences.

Describe visual elements: characters, setting, lighting, colors, atmosphere. Be specific on what's going on in the scene.

Output ONLY the image prompt, nothing else. No quotes, no explanations.`;

  // Add user guidance if provided
  if (guidance && guidance.trim()) {
    systemPrompt += `\n\nIMPORTANT - Follow this guidance from the user:\n${guidance}`;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `https://${host}`,
      'X-Title': 'purple valley'
    },
    body: JSON.stringify({
      model: CONFIG.PROMPT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      max_tokens: 150,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error('Failed to generate image prompt');
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// Generate image using OpenRouter (via chat completions endpoint)
async function generateImageOpenRouter(prompt, apiKey, host) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `https://${host}`,
      'X-Title': 'purple valley'
    },
    body: JSON.stringify({
      model: CONFIG.OPENROUTER_IMAGE_MODEL,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenRouter image generation error:', errorText);
    throw new Error('Failed to generate image');
  }

  const data = await response.json();

  // Check for image URL in various possible locations
  let imageUrl = null;

  // Check for images array in message (seedream format)
  const messageImages = data.choices?.[0]?.message?.images;
  if (messageImages && messageImages.length > 0) {
    const firstImage = messageImages[0];
    imageUrl = firstImage.image_url?.url || firstImage.url || firstImage;
  }

  // Check message content for URL
  if (!imageUrl) {
    const content = data.choices?.[0]?.message?.content;
    if (content && content.trim()) {
      const mdMatch = content.match(/!\[.*?\]\((.*?)\)/);
      if (mdMatch) {
        imageUrl = mdMatch[1];
      }
      const urlMatch = content.match(/(https?:\/\/[^\s\)"']+)/i);
      if (urlMatch && !imageUrl) {
        imageUrl = urlMatch[1];
      }
      if (!imageUrl && content.startsWith('data:image')) {
        imageUrl = content;
      }
    }
  }

  // Check for image_url in message
  if (!imageUrl) {
    const messageImageUrl = data.choices?.[0]?.message?.image_url;
    if (messageImageUrl) {
      imageUrl = messageImageUrl.url || messageImageUrl;
    }
  }

  return { url: imageUrl };
}

// Generate image using Replicate
async function generateImageReplicate(prompt, apiKey) {
  const model = CONFIG.REPLICATE_MODEL;
  console.log('Using Replicate model:', model);

  // Create prediction
  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      input: {
        prompt: prompt
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Replicate create prediction error:', errorText);
    throw new Error('Failed to create Replicate prediction');
  }

  let prediction = await response.json();
  console.log('Replicate prediction created:', prediction.id, 'status:', prediction.status);

  // Poll for completion (max 60 seconds)
  const maxAttempts = 60;
  let attempts = 0;

  while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const pollResponse = await fetch(prediction.urls.get, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      }
    });

    if (!pollResponse.ok) {
      throw new Error('Failed to poll Replicate prediction');
    }

    prediction = await pollResponse.json();
    attempts++;

    if (attempts % 5 === 0) {
      console.log('Replicate polling attempt', attempts, 'status:', prediction.status);
    }
  }

  if (prediction.status === 'failed') {
    console.error('Replicate prediction failed:', prediction.error);
    throw new Error(prediction.error || 'Replicate prediction failed');
  }

  if (prediction.status !== 'succeeded') {
    throw new Error('Replicate prediction timed out');
  }

  // Get the output URL - usually an array with the image URL
  const output = prediction.output;
  let imageUrl = null;

  if (Array.isArray(output) && output.length > 0) {
    imageUrl = output[0];
  } else if (typeof output === 'string') {
    imageUrl = output;
  }

  console.log('Replicate image generated:', imageUrl?.substring(0, 100));
  return { url: imageUrl };
}

// Generate image using configured provider
async function generateImage(prompt, apiKey, host) {
  const provider = getImageProvider();

  if (provider === 'replicate') {
    const replicateKey = process.env.REPLICATE_API_KEY;
    if (!replicateKey) {
      throw new Error('REPLICATE_API_KEY not configured');
    }
    return generateImageReplicate(prompt, replicateKey);
  } else {
    return generateImageOpenRouter(prompt, apiKey, host);
  }
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, guidance } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const host = req.headers.host || 'localhost';

  try {
    // Step 1: Generate image prompt from text (with optional guidance)
    console.log('Generating image prompt from text...');
    if (guidance) console.log('With guidance:', guidance);
    const basePrompt = await generateImagePrompt(text, apiKey, host, guidance);

    if (!basePrompt) {
      return res.status(500).json({ error: 'Failed to generate image prompt' });
    }

    // Step 2: Add Miyazaki style suffix
    const finalPrompt = basePrompt + CONFIG.STYLE_SUFFIX;
    console.log('Final prompt:', finalPrompt);

    // Step 3: Generate image
    console.log('Generating image...');
    const imageResult = await generateImage(finalPrompt, apiKey, host);

    // Return the image data
    res.status(200).json({
      success: true,
      prompt: finalPrompt,
      image: imageResult.data?.[0] || imageResult
    });

  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate image' });
  }
}
