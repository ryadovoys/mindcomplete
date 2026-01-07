const CONFIG = {
    PROMPT_MODEL: 'xiaomi/mimo-v2-flash:free',
    OPENROUTER_IMAGE_MODEL: 'bytedance-seed/seedream-4.5',
    REPLICATE_MODEL: process.env.REPLICATE_MODEL || 'prunaai/z-image-turbo',
};

const STYLE_MAPPING = {
    'anime': 'Transform the provided reference image into a whimsical, heartfelt Studio Ghibli–inspired illustration while preserving the original composition and key subjects. Use a soft yet vibrant color palette, gentle gradients, and a warm, natural atmosphere; emphasize detailed nature-filled backgrounds (lush foliage, sky, subtle environmental storytelling) with hand-crafted textures that feel like traditional animation. Render characters with expressive, simplified forms and large, emotive eyes where appropriate, keeping their likeness and pose recognizable. Add hand-drawn linework and watercolor / gouache-like textures, then refine with careful light and shadow to create depth, soft bloom, and cinematic warmth. Finish with cohesive adjustments to lighting, contrast, and saturation so the scene feels unified and magical—authentic to classic Ghibli moods—while clearly retaining the essence of the original image.',

    'realistic': 'Highly realistic, cinematic lighting, 8k resolution, detailed texture',

    'handdrawing': 'Hand-drawn sketch, artistic pencil drawing, rough texture, expressive lines',

    'custom1': 'Sensual emphasis on body contours, intimate framing, and emotional connection. Focus on faces, hands, flowing hair, and silhouettes with soft lighting. Use strategic composition (implied nudity through shadows/fabric) to highlight curves and emotional intensity without explicit focus. Maintain artistic framing and natural anatomy emphasis.',

    'custom2': 'First-person male perspective POV. Frame should show ONLY the female subject from the viewer\'s sightline. No male body parts in frame. Composition should capture the subject directly facing viewer with intimate proximity. Use environmental perspective cues (hands in lower frame, bed/sofa context) to imply male presence without visual inclusion.'
};

function getImageProvider() {
    return process.env.IMAGE_PROVIDER || 'openrouter';
}

async function generateImagePrompt(text, apiKey, host, guidance = '', style = 'realistic') {
    let styleHint = '';
    if (style === 'realistic') {
        styleHint = 'Hyper realistic image with cinematic lighting, 8k resolution, detailed texture.';
    } else if (style === 'handdrawing') {
        styleHint = 'The image MUST look like a hand-drawn pencil sketch or artistic drawing.';
    } else if (style === 'anime') {
        styleHint = 'The image should be in the signature style of Studio Ghibli and Hayao Miyazaki.';
    } else if (style === 'custom1') {
        styleHint = 'Sensual artistic nude focus: Highlight body curves, emotional expressions, and intimate connection through lighting and composition. Emphasize faces, hair, hands, and silhouette while using shadows/fabric for partial concealment. No explicit focus on genital areas.';
    } else if (style === 'custom2') {
        styleHint = 'Strict first-person POV from male perspective: Show ONLY the female subject. No male body parts visible. Frame should feel intimate and direct with environmental cues (hands, bedding) implying male presence.';
    }

    let systemPrompt = `You are an image prompt generator. Analyze the given text and create a short, vivid image prompt in a paragraph format that illustrates the scene. Describe visual elements: characters, setting, lighting, colors, atmosphere. Visual style: ${styleHint} Output ONLY the image prompt, nothing else. No quotes, no explanations.`;

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
            messages: [{ role: 'user', content: prompt }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenRouter image generation error:', errorText);
        throw new Error('Failed to generate image');
    }

    const data = await response.json();
    let imageUrl = null;

    const messageImages = data.choices?.[0]?.message?.images;
    if (messageImages && messageImages.length > 0) {
        const firstImage = messageImages[0];
        imageUrl = firstImage.image_url?.url || firstImage.url || firstImage;
    }

    if (!imageUrl) {
        const content = data.choices?.[0]?.message?.content;
        if (content && content.trim()) {
            const mdMatch = content.match(/!\[.*?\]\((.*?)\)/);
            if (mdMatch) imageUrl = mdMatch[1];
            const urlMatch = content.match(/(https?:\/\/[^\s\)"']+)/i);
            if (urlMatch && !imageUrl) imageUrl = urlMatch[1];
            if (!imageUrl && content.startsWith('data:image')) imageUrl = content;
        }
    }

    if (!imageUrl) {
        const messageImageUrl = data.choices?.[0]?.message?.image_url;
        if (messageImageUrl) imageUrl = messageImageUrl.url || messageImageUrl;
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
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text, guidance, style } = req.body;

    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Text is required' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
        return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const host = req.headers.host || 'localhost';

    try {
        console.log('Generating image prompt, style:', style);
        const basePrompt = await generateImagePrompt(text, apiKey, host, guidance, style);

        if (!basePrompt) {
            return res.status(500).json({ error: 'Failed to generate image prompt' });
        }

        const styleSuffix = STYLE_MAPPING[style] || STYLE_MAPPING['realistic'];
        const finalPrompt = basePrompt + styleSuffix;
        console.log('Final prompt:', finalPrompt);

        const imageResult = await generateImage(finalPrompt, apiKey, host);

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
