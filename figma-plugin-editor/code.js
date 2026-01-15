// MindComplete Editor - Figma Plugin
// Text editor with inline AI suggestions

figma.showUI(__html__, {
    width: 500,
    height: 600,
    title: 'MindComplete Editor',
    themeColors: true
});

// Collect all text from a Section
function collectSectionText(section) {
    var texts = [];

    function traverse(node) {
        if (node.type === 'TEXT') {
            if (node.characters && node.characters.trim()) {
                texts.push({
                    name: node.name,
                    text: node.characters.trim()
                });
            }
        }
        if ('children' in node) {
            for (var i = 0; i < node.children.length; i++) {
                traverse(node.children[i]);
            }
        }
    }

    traverse(section);
    return texts;
}

// Get context from selected Section
function getContextFromSelection() {
    var selection = figma.currentPage.selection;

    if (selection.length === 0) {
        return { success: false, error: 'No selection. Select a Section for context.' };
    }

    var node = selection[0];

    // If it's a Section, collect all text as context
    if (node.type === 'SECTION') {
        var texts = collectSectionText(node);
        var contextText = texts.map(function (t) {
            return t.text;
        }).join('\n\n');

        return {
            success: true,
            type: 'section',
            name: node.name,
            context: contextText,
            items: texts
        };
    }

    // If it's a Frame or Group, also collect text
    if (node.type === 'FRAME' || node.type === 'GROUP') {
        var texts = collectSectionText(node);
        var contextText = texts.map(function (t) {
            return t.text;
        }).join('\n\n');

        return {
            success: true,
            type: 'frame',
            name: node.name,
            context: contextText,
            items: texts
        };
    }

    return {
        success: false,
        error: 'Please select a Section or Frame for context.'
    };
}

// Listen for messages from the UI
figma.ui.onmessage = function (msg) {

    // Get context from selection
    if (msg.type === 'get-context') {
        var result = getContextFromSelection();
        figma.ui.postMessage({
            type: 'context-result',
            success: result.success,
            error: result.error,
            contextType: result.type,
            name: result.name,
            context: result.context,
            items: result.items
        });
    }

    // Insert text into selected TextNode or create new
    if (msg.type === 'export-to-canvas') {
        var text = msg.text;
        var selection = figma.currentPage.selection;

        // If a TextNode is selected, append text to it
        if (selection.length > 0 && selection[0].type === 'TEXT') {
            var textNode = selection[0];

            // Load the font used in the text node
            var fontName = textNode.fontName;
            if (fontName === figma.mixed) {
                fontName = { family: "Inter", style: "Regular" };
            }

            figma.loadFontAsync(fontName).then(function () {
                // Append text to existing content
                var existingText = textNode.characters;
                var newText = existingText ? existingText + ' ' + text : text;
                textNode.characters = newText;

                figma.ui.postMessage({ type: 'export-result', success: true });
                figma.notify('✨ Text inserted!', { timeout: 2000 });
            }).catch(function () {
                figma.ui.postMessage({ type: 'export-result', success: false, error: 'Failed to load font' });
            });
        } else {
            // No text selected - create new text node
            var parent = selection.length > 0 ? selection[0].parent : figma.currentPage;
            var textNode = figma.createText();

            figma.loadFontAsync({ family: "Inter", style: "Regular" }).then(function () {
                textNode.characters = text;
                textNode.fontSize = 16;
                textNode.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.98 } }];

                if (selection.length > 0) {
                    var sel = selection[0];
                    textNode.x = sel.x;
                    textNode.y = sel.y + sel.height + 20;
                }

                if (parent.type === 'SECTION' || parent.type === 'FRAME' || parent.type === 'GROUP') {
                    parent.appendChild(textNode);
                }

                figma.currentPage.selection = [textNode];
                figma.viewport.scrollAndZoomIntoView([textNode]);

                figma.ui.postMessage({ type: 'export-result', success: true });
                figma.notify('✨ New text created!', { timeout: 2000 });
            }).catch(function () {
                figma.ui.postMessage({ type: 'export-result', success: false, error: 'Failed to load font' });
            });
        }
    }

    // Resize
    if (msg.type === 'resize') {
        figma.ui.resize(msg.width, msg.height);
    }

    // Close
    if (msg.type === 'close') {
        figma.closePlugin();
    }
};

// Listen for selection changes
figma.on('selectionchange', function () {
    var result = getContextFromSelection();
    figma.ui.postMessage({
        type: 'selection-changed',
        success: result.success,
        error: result.error,
        contextType: result.type,
        name: result.name,
        context: result.context,
        items: result.items
    });
});
