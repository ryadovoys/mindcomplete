// Context Anchor API endpoint
// Generates and manages the unified Context Anchor for a session

import { supabase } from './_lib/supabaseClient.js';
import {
    combineContextItems,
    generateClarifications,
    synthesizeContextAnchor as fallbackSynthesis
} from './_lib/contextDigest.js';

const MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-flash-1.5',
    'openai/gpt-4o-mini',
];

export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET - Retrieve existing anchor(s)
    if (req.method === 'GET') {
        const anchorId = req.query.id;

        try {
            // Get user ID if authenticated
            let userId = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7);
                const { data: { user } } = await supabase.auth.getUser(token);
                userId = user?.id || null;
            }

            if (anchorId) {
                // Get specific anchor
                const { data, error } = await supabase
                    .from('context_anchors')
                    .select('*')
                    .eq('id', anchorId)
                    .single();

                if (error || !data) {
                    return res.status(404).json({ error: 'Anchor not found' });
                }
                return res.status(200).json(data);
            } else {
                if (!userId) {
                    return res.status(401).json({ error: 'Authentication required to list anchors' });
                }

                const { data, error } = await supabase
                    .from('context_anchors')
                    .select('*')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });

                if (error) {
                    throw error;
                }

                return res.status(200).json(data || []);
            }
        } catch (error) {
            console.error('[CONTEXT-ANCHOR] GET error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // POST - Create new anchor or generate clarifications
    if (req.method === 'POST') {
        const { items, rules, writingStyle, preferences, action } = req.body;

        // Generate clarifications only (no anchor creation yet)
        if (action === 'clarify') {
            const combined = combineContextItems(items || []);

            // ... (clarification logic remains same, specialized for structure) ...
            // For now using the lib function, but could be LLM powered too.
            const options = {
                hasImages: (items || []).some(i => i.type === 'image' || i.source === 'image_analysis'),
                hasText: (items || []).some(i => i.type === 'file' || i.type === 'url'),
                urlDomains: (items || [])
                    .filter(i => i.type === 'url' && i.url)
                    .map(i => {
                        try { return new URL(i.url).hostname; } catch { return null; }
                    })
                    .filter(Boolean),
            };

            const clarifications = generateClarifications(combined.digest, options);

            return res.status(200).json({
                clarifications,
                needsClarification: clarifications.length > 0,
                digest: combined.digest,
                estimatedTokens: combined.estimatedTokens,
            });
        }

        // Create the anchor
        try {
            const combined = combineContextItems(items || []);

            // Try LLM Synthesis first
            let anchorText;

            // Check if it's a simple text-only anchor (no files, no images, no URLs)
            const isTextOnly = items.length === 1 && items[0].type === 'instruction';

            if (isTextOnly) {
                anchorText = items[0].content;
            } else {
                try {
                    anchorText = await synthesizeWithLLM(items, combined.digest, { rules, writingStyle, preferences });
                } catch (llmError) {
                    console.warn('[CONTEXT-ANCHOR] LLM Synthesis failed, using fallback:', llmError);
                    anchorText = fallbackSynthesis(combined.digest, preferences || {}, {
                        rules,
                        writingStyle,
                    });
                }
            }


            // Get user ID if authenticated
            let userId = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7);
                const { data: { user } } = await supabase.auth.getUser(token);
                userId = user?.id || null;
            }

            // Save to database
            const { data, error } = await supabase
                .from('context_anchors')
                .insert({
                    user_id: userId,
                    summary: anchorText,
                    items: items || [],
                    rules: rules || null,
                    writing_style: writingStyle || null,
                    clarifications: preferences || null,
                })
                .select()
                .single();

            if (error) {
                console.error('[CONTEXT-ANCHOR] Insert error:', error);
                return res.status(500).json({ error: 'Failed to save anchor' });
            }

            console.log(`[CONTEXT-ANCHOR] Created anchor: ${data.id}`);

            return res.status(201).json({
                anchorId: data.id,
                summary: anchorText,
                estimatedTokens: combined.estimatedTokens,
                itemCount: combined.itemCount,
            });
        } catch (error) {
            console.error('[CONTEXT-ANCHOR] POST error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // PUT - Update existing anchor with new preferences
    if (req.method === 'PUT') {
        const { anchorId, preferences, items, rules, writingStyle } = req.body;

        if (!anchorId) {
            return res.status(400).json({ error: 'Anchor ID is required' });
        }

        try {
            // Fetch existing anchor
            const { data: existing, error: fetchError } = await supabase
                .from('context_anchors')
                .select('*')
                .eq('id', anchorId)
                .single();

            if (fetchError || !existing) {
                return res.status(404).json({ error: 'Anchor not found' });
            }

            // Merge items and regenerate anchor
            const mergedItems = items || existing.items || [];
            const combined = combineContextItems(mergedItems);
            const mergedPreferences = { ...(existing.clarifications || {}), ...(preferences || {}) };

            const anchor = synthesizeContextAnchor(combined.digest, mergedPreferences, {
                rules: rules || existing.rules,
                writingStyle: writingStyle || existing.writing_style,
            });

            // Update in database
            const { data, error: updateError } = await supabase
                .from('context_anchors')
                .update({
                    summary: anchor,
                    items: mergedItems,
                    rules: rules || existing.rules,
                    writing_style: writingStyle || existing.writing_style,
                    clarifications: mergedPreferences,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', anchorId)
                .select()
                .single();

            if (updateError) {
                console.error('[CONTEXT-ANCHOR] Update error:', updateError);
                return res.status(500).json({ error: 'Failed to update anchor' });
            }

            return res.status(200).json({
                anchorId: data.id,
                summary: anchor,
                estimatedTokens: combined.estimatedTokens,
                itemCount: combined.itemCount,
            });

        } catch (error) {
            console.error('[CONTEXT-ANCHOR] PUT error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // DELETE - Remove anchor
    if (req.method === 'DELETE') {
        const anchorId = req.query.id || req.body?.anchorId;

        if (!anchorId) {
            return res.status(400).json({ error: 'Anchor ID is required' });
        }

        try {
            const { error } = await supabase
                .from('context_anchors')
                .delete()
                .eq('id', anchorId);

            if (error) {
                console.error('[CONTEXT-ANCHOR] Delete error:', error);
                return res.status(500).json({ error: 'Failed to delete anchor' });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error('[CONTEXT-ANCHOR] DELETE error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

async function synthesizeWithLLM(items, fullDigest, options) {
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not configured');
    }

    // --- Detect Flow Type ---
    const hasImage = items.some(i => i.source === 'image_analysis' || i.type === 'image');
    const hasFile = items.some(i => i.type === 'file');
    const hasUrl = items.some(i => i.type === 'url' || i.source === 'scraped_url');
    const hasInstruction = items.some(i => i.type === 'instruction');

    const userInstruction = items.find(i => i.type === 'instruction')?.content || '';
    const contentItem = items.find(i => i.type !== 'instruction');

    let systemPrompt;
    let maxTokens = 500;

    // --- FLOW 1: Image Only ---
    if (hasImage && !hasInstruction) {
        systemPrompt = `You are analyzing an image for a writing assistant.
Your task is to provide a DETAILED VISUAL DESCRIPTION of the image.

OUTPUT:
Describe what you see in the image. Include:
- Main subjects (people, objects, scenes)
- Colors, lighting, and atmosphere
- Setting and environment
- Mood and emotional tone
- Any text visible in the image
- Notable details that could inspire creative writing

Be thorough and vivid. This description will help a writer understand the visual context.
Output ONLY the description. No headers, no commentary.`;
    }

    // --- FLOW 2: Image + Comment ---
    else if (hasImage && hasInstruction) {
        systemPrompt = `You are analyzing an image for a writing assistant.
The user has provided specific guidance on what to focus on.

USER'S GUIDANCE: "${userInstruction}"

Based on this guidance, analyze the image and extract the relevant details.
Focus specifically on what the user asked for.

OUTPUT:
Provide a focused analysis based on the user's guidance.
Only include details relevant to their request.
Output ONLY the analysis. No headers, no meta-commentary.`;
    }

    // --- FLOW 3: File/URL Only ---
    else if ((hasFile || hasUrl) && !hasInstruction) {
        systemPrompt = `You are a document analyst for a writing assistant.
Your task is to create a COMPREHENSIVE SUMMARY of the provided document/content.

This summary will be used to help an AI assist the user with writing.
Make the summary rich and detailed so the AI understands the full context.

OUTPUT GUIDELINES:
- Capture the main themes, arguments, or narrative
- Note key characters, places, or concepts if applicable
- Preserve important details, quotes, or data points
- Identify the tone and style of the original content
- Include anything that would be helpful for continued writing

Be generous with detail. Up to 2000 characters is acceptable.
Output ONLY the summary. No headers like "Summary:" - just the content.`;
        maxTokens = 800; // Allow more tokens for detailed summaries
    }

    // --- FLOW 4: File/URL + Comment ---
    else if ((hasFile || hasUrl) && hasInstruction) {
        systemPrompt = `You are a document analyst for a writing assistant.
The user has provided specific guidance on what to extract from this document.

USER'S GUIDANCE: "${userInstruction}"

Based on this guidance, analyze the document and extract the relevant information.
Focus specifically on what the user asked for.

Examples:
- If they mention "characters", list all characters with descriptions
- If they mention "plot", summarize the main storyline
- If they mention "style", analyze the writing style and tone

OUTPUT:
Provide a focused extraction based on the user's guidance.
Be thorough for the specific aspects they requested.
Up to 2000 characters is acceptable.
Output ONLY the analysis. No headers, no meta-commentary.`;
        maxTokens = 800;
    }

    // --- FALLBACK: Mixed or Text-only ---
    else {
        systemPrompt = `You are a context analyzer for a writing assistant.
Summarize the provided content in a way that helps with writing tasks.
Be clear and concise. Focus on information useful for creative or professional writing.
Output ONLY the summary.`;
    }

    // --- Build User Prompt ---
    const contentDescription = items.map(i => {
        if (i.type === 'instruction') return null;
        if (i.source === 'image_analysis') return `[IMAGE DESCRIPTION]: ${i.content}`;
        if (i.type === 'file') return `[FILE: ${i.name}]: ${i.content}`;
        if (i.type === 'url' || i.source === 'scraped_url') {
            return `[URL: ${i.meta?.url || 'unknown'}]\nTitle: ${i.meta?.title || ''}\n${i.content}`;
        }
        return `[CONTENT]: ${i.content}`;
    }).filter(Boolean).join('\n\n');

    const userPrompt = contentDescription;

    // --- Call LLM ---
    for (const model of MODELS) {
        try {
            console.log(`[CONTEXT-ANCHOR] Synthesizing with model: ${model} (Flow: ${hasImage ? 'image' : hasFile ? 'file' : hasUrl ? 'url' : 'other'}${hasInstruction ? '+comment' : ''})`);
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://mindcomplete.vercel.app',
                    'X-Title': 'Mindcomplete',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.5,
                    max_tokens: maxTokens
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenRouter error: ${response.status} - ${errText}`);
            }

            const result = await response.json();
            return result.choices[0].message.content.trim();

        } catch (err) {
            console.warn(`[CONTEXT-ANCHOR] Model ${model} failed:`, err.message);
            // Try next model
        }
    }

    throw new Error('All models failed to synthesize anchor');
}

