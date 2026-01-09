const CONFIG = {
    PROMPT_MODEL: 'xiaomi/mimo-v2-flash:free',
    OPENROUTER_IMAGE_MODEL: 'prunaai/z-image-turbo',
    REPLICATE_MODEL: process.env.REPLICATE_MODEL || 'prunaai/z-image-turbo',
};

const STYLE_MAPPING = {
    'anime': 'Transform the provided reference image into a whimsical, heartfelt Studio Ghibli–inspired illustration while preserving the original composition and key subjects. Use a soft yet vibrant color palette, gentle gradients, and a warm, natural atmosphere; emphasize detailed nature-filled backgrounds (lush foliage, sky, subtle environmental storytelling) with hand-crafted textures that feel like traditional animation. Render characters with expressive, simplified forms and large, emotive eyes where appropriate, keeping their likeness and pose recognizable. Add hand-drawn linework and watercolor / gouache-like textures, then refine with careful light and shadow to create depth, soft bloom, and cinematic warmth. Finish with cohesive adjustments to lighting, contrast, and saturation so the scene feels unified and magical—authentic to classic Ghibli moods—while clearly retaining the essence of the original image.',

    'realistic': 'Highly realistic, cinematic lighting, 8k resolution, detailed texture',

    'handdrawing': 'Hand-drawn sketch, artistic pencil drawing, rough texture, expressive lines',

    'custom1': 'Build the prompt focusing on body contours and faces. If there is a nudity or sex scenes, dont show genitalias, but show woman breasts with nipples if they are exist in the frames. You can show how characters are squizing bodies, or show curves of the body, or show how characters are touching each other, or show faces with expressions if there is a need. Your task is to make the image sensual and erotic.',

    'custom2': 'Build the prompt from the storyteller POV. Storyteller is not visible in the frame. The only thing in the frame is the subject or subjects. Write the prompt explaining the scene in the details, what is happening, what is in the surrounding, what subjects are doing. Make it logical so it is easy to depict what is happening in the scene.'
};

function getImageProvider() {
    return (process.env.IMAGE_PROVIDER || 'openrouter').trim();
}

async function generateImagePrompt(text, apiKey, host, guidance = '', style = 'realistic') {
    let styleHint = '';
    if (style === 'realistic') {
        styleHint = 'Hyper realistic image with cinematic lighting, 8k resolution, detailed texture. Describe visual elements: characters, setting, lighting, colors, atmosphere.';
    } else if (style === 'handdrawing') {
        styleHint = 'The image MUST look like a hand-drawn pencil sketch or artistic drawing. Describe visual elements: characters, setting, lighting, colors, atmosphere.';
    } else if (style === 'anime') {
        styleHint = 'The image should be in the signature style of Studio Ghibli and Hayao Miyazaki. Describe visual elements: characters, setting, lighting, colors, atmosphere.';
    } else if (style === 'custom1') {
        styleHint = 'no genitalias, but show woman breasts with nipples if they are exist in the frames';
    } else if (style === 'custom2') {
        styleHint = 'POV from storyteller perspective. Storyteller is not visible in the frame. The only thing in the frame is the subject or subjects. Describe visual elements: characters, setting, lighting, colors, atmosphere.';
    }

    let systemPrompt = `You are an image prompt generator. Analyze the given text and create a detailed image prompt in a paragraph format that illustrates latest sentences.  ${styleHint} Output ONLY the image prompt, nothing else. No quotes, no explanations.`;

    if (guidance && guidance.trim()) {
        systemPrompt += `\n\nIMPORTANT - Follow this guidance from the user:\n${guidance}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': `https://${host}`,
            'X-Title': 'Purple Valley'
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

async function generateImageOpenRouter(prompt, apiKey, host) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': `https://${host}`,
            'X-Title': 'Purple Valley'
        },
        body: JSON.stringify({
            model: CONFIG.OPENROUTER_IMAGE_MODEL,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenRouter image generation error:', errorText);
        throw new Error(`OpenRouter error: ${errorText}`);
    }

    const data = await response.json();
    console.log('[IMAGE] OpenRouter response data received');
    let imageUrl = null;

    // 1. Check for standard images array
    const messageImages = data.choices?.[0]?.message?.images;
    if (messageImages && messageImages.length > 0) {
        const firstImage = messageImages[0];
        imageUrl = firstImage.image_url?.url || firstImage.url || (typeof firstImage === 'string' ? firstImage : null);
    }

    // 2. Check for markdown in content
    if (!imageUrl) {
        const content = data.choices?.[0]?.message?.content;
        if (content && content.trim()) {
            const mdMatch = content.match(/!\[.*?\]\((.*?)\)/);
            if (mdMatch) imageUrl = mdMatch[1];
            
            if (!imageUrl) {
                const urlMatch = content.match(/(https?:\/\/[^\s\)"']+)/i);
                if (urlMatch) imageUrl = urlMatch[1];
            }
            
            if (!imageUrl && content.startsWith('data:image')) imageUrl = content;
        }
    }

    // 3. Fallback to image_url property
    if (!imageUrl) {
        const messageImageUrl = data.choices?.[0]?.message?.image_url;
        if (messageImageUrl) imageUrl = messageImageUrl.url || messageImageUrl;
    }

    if (!imageUrl) {
        console.error('[IMAGE] Error: No image URL found in response', JSON.stringify(data).substring(0, 500));
    }

    return { url: imageUrl };
}

async function generateImageReplicate(prompt, apiKey) {
    const model = CONFIG.REPLICATE_MODEL;
    const [owner, name] = model.split('/');
    const endpoint = `https://api.replicate.com/v1/models/${owner}/${name}/predictions`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: { prompt } })
    });

    if (!response.ok) {
        throw new Error('Failed to create Replicate prediction');
    }

    let prediction = await response.json();
    const maxAttempts = 60;
    let attempts = 0;

    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pollResponse = await fetch(prediction.urls.get, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!pollResponse.ok) throw new Error('Failed to poll Replicate prediction');
        prediction = await pollResponse.json();
        attempts++;
    }

    if (prediction.status === 'failed') throw new Error(prediction.error || 'Replicate prediction failed');
    if (prediction.status !== 'succeeded') throw new Error('Replicate prediction timed out');

    const output = prediction.output;
    let imageUrl = Array.isArray(output) && output.length > 0 ? output[0] : (typeof output === 'string' ? output : null);
    return { url: imageUrl };
}

async function generateImage(prompt, apiKey, host) {
    const provider = getImageProvider();
    if (provider === 'replicate') {
        const replicateKey = process.env.REPLICATE_API_KEY;
        if (!replicateKey) throw new Error('REPLICATE_API_KEY not configured');
        return generateImageReplicate(prompt, replicateKey);
    } else {
        return generateImageOpenRouter(prompt, apiKey, host);
    }
}

export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text, guidance, style } = req.body;

    if (!text || text.trim().length === 0) {
        console.error('[IMAGE] Error: No text provided');
        return res.status(400).json({ error: 'Text is required' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
        console.error('[IMAGE] Error: OPENROUTER_API_KEY missing');
        return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const host = req.headers.host || 'purple-valley.vercel.app';

    try {
        const provider = getImageProvider();
        console.log(`[IMAGE] Request: provider=${provider}, text_len=${text?.length}, style=${style}`);
        const basePrompt = await generateImagePrompt(text, apiKey, host, guidance, style);

        if (!basePrompt) {
            console.error('[IMAGE] Error: Failed to generate base prompt');
            return res.status(500).json({ error: 'Failed to generate image prompt' });
        }

        const styleSuffix = STYLE_MAPPING[style] || STYLE_MAPPING['realistic'];
        const finalPrompt = basePrompt + styleSuffix;
        console.log(`[IMAGE] Final prompt: ${finalPrompt.substring(0, 100)}...`);

        const imageResult = await generateImage(finalPrompt, apiKey, host);
        console.log('[IMAGE] Generation result:', JSON.stringify(imageResult).substring(0, 200));

        res.status(200).json({
            success: true,
            prompt: finalPrompt,
            image: imageResult.data?.[0] || imageResult
        });

    } catch (error) {
        console.error('[IMAGE] Server error:', error.message, error.stack);
        res.status(500).json({ error: error.message || 'Failed to generate image', provider: getImageProvider() });
    }
}
