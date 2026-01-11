import { supabase } from './lib/supabaseClient.js';
import { ADMIN_EMAILS } from './lib/constants.js';
import { getUserTier, getUserCredits, deductCredit, getMonthlyImageCount } from './lib/tierService.js';

const CONFIG = {
    PROMPT_MODEL: 'xiaomi/mimo-v2-flash:free',
    OPENROUTER_IMAGE_MODEL: 'prunaai/z-image-turbo',
    REPLICATE_MODEL: process.env.REPLICATE_MODEL || 'prunaai/z-image-turbo',
};

const STYLE_MAPPING = {
    'anime': 'Whimsical, heartfelt Studio Ghibli–inspired illustration. Use a soft yet vibrant color palette, gentle gradients, and a warm, natural atmosphere; emphasize detailed nature-filled backgrounds (lush foliage, sky, subtle environmental storytelling) with hand-crafted textures that feel like traditional hand-drawn animation. Subjects should have expressive, simplified forms if present. Add hand-drawn linework and watercolor / gouache-like textures, then refine with careful light and shadow to create depth, soft bloom, and cinematic warmth. Scene should feel unified and magical—authentic to classic Hayao Miyazaki moods.',

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
        styleHint = 'The image should be in the signature style of Studio Ghibli and Hayao Miyazaki. Describe visual elements: setting, lighting, colors, atmosphere, and any subjects if they are part of the story.';
    } else if (style === 'custom1') {
        styleHint = 'no genitalias, but show woman breasts with nipples if they are exist in the frames';
    } else if (style === 'custom2') {
        styleHint = 'POV from storyteller perspective. Storyteller is not visible in the frame. The only thing in the frame is the subject or subjects. Describe visual elements: characters, setting, lighting, colors, atmosphere.';
    }

    let systemPrompt = `You are an expert image prompt engineer. Your task is to generate a detailed, visually descriptive prompt for an image based on the provided text.

Follow this hierarchy for prompt generation:
1. OVERALL CONTEXT: Use the entire text to establish the setting, atmosphere, and recurring characters or elements.
2. RECENT CONTEXT: Focus on the last few sentences to define the specific scene and surrounding details.
3. CORE ACTION: The very last sentence or phrase describes the immediate action or focal point. Make this the central, most prominent element of the image.

${styleHint}

Output ONLY the final image prompt in a single paragraph. Do not include any meta-talk, quotes, or explanations.`;

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

async function imageUrlToBase64(url) {
    if (!url || url.startsWith('data:')) return url;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || 'image/png';
        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (e) {
        console.error(`[IMAGE] Conversion error for ${url}:`, e.message);
        return url; // Fallback to original URL if conversion fails
    }
}

async function getUserFromToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error) return null;
        return user;
    } catch (e) {
        return null;
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
    const host = req.headers.host || 'purplevalley.co';

    try {
        // 1. Auth check
        const user = await getUserFromToken(req.headers.authorization);
        if (!user) {
            return res.status(401).json({ error: 'Sign in to generate images' });
        }

        const isAdmin = ADMIN_EMAILS.includes(user.email);
        let remaining = 0;
        let usedCredit = false;

        // 2. Tier-based limit check (skip for admins)
        if (!isAdmin) {
            const { tier, limits } = await getUserTier(user.id);
            const monthlyCount = await getMonthlyImageCount(user.id);
            const monthlyLimit = limits.images_per_month;

            // Free tier: no images allowed
            if (tier === 'free') {
                return res.status(403).json({
                    error: 'Upgrade to Pro to generate images',
                    tier: 'free',
                    remaining: 0,
                    upgradeRequired: true
                });
            }

            // Pro tier: check monthly limit
            remaining = Math.max(0, monthlyLimit - monthlyCount);

            if (remaining <= 0) {
                // Check if user has credits
                const credits = await getUserCredits(user.id);
                if (credits > 0) {
                    // Will use a credit
                    usedCredit = true;
                    remaining = credits;
                } else {
                    return res.status(429).json({
                        error: `You've used all ${monthlyLimit} Pro images this month. Buy credits to continue.`,
                        tier: 'pro',
                        remaining: 0,
                        credits: 0,
                        needsCredits: true
                    });
                }
            }
        } else {
            remaining = 999; // Unlimited for admin
        }

        const provider = getImageProvider();
        console.log(`[IMAGE] Request: user=${user.email}, provider=${provider}, text_len=${text?.length}, style=${style}`);
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

        // Convert to base64 to ensure persistence
        const imageUrl = imageResult.url || (imageResult.data?.[0]?.url) || (imageResult.data?.[0]);
        const base64Image = await imageUrlToBase64(imageUrl);

        // 3. Deduct credit if used
        if (usedCredit && !isAdmin) {
            const deducted = await deductCredit(user.id);
            if (!deducted) {
                console.error('[IMAGE] Failed to deduct credit');
            } else {
                console.log('[IMAGE] Used 1 credit');
            }
        }

        // 4. Track generation
        const { error: trackError } = await supabase
            .from('image_generations')
            .insert({
                user_id: user.id,
                user_email: user.email
            });

        if (trackError) {
            console.error('[IMAGE] Tracking error:', trackError);
        }

        // Get updated credits if used
        const finalCredits = usedCredit ? await getUserCredits(user.id) : null;

        res.status(200).json({
            success: true,
            prompt: finalPrompt,
            image: base64Image,
            remaining: isAdmin ? 999 : (usedCredit ? finalCredits : remaining - 1),
            usedCredit
        });

    } catch (error) {
        console.error('[IMAGE] Server error:', error.message, error.stack);
        res.status(500).json({ error: error.message || 'Failed to generate image', provider: getImageProvider() });
    }
}
