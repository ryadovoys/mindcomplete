// MindComplete Figma Plugin - Main Code

var pluginMode = 'panel'; // 'panel' or 'quick'

// Handle different run commands
figma.on('run', function (event) {
    if (event.command === 'continue-quick') {
        // Quick mode - generate and insert without UI
        pluginMode = 'quick';
        runQuickContinue();
    } else {
        // Default - open panel
        pluginMode = 'panel';
        figma.showUI(__html__, {
            width: 300,
            height: 320,
            title: 'MindComplete',
            themeColors: true
        });
    }
});

// Quick continue without UI
function runQuickContinue() {
    var selection = figma.currentPage.selection;

    if (selection.length === 0 || selection[0].type !== 'TEXT') {
        figma.notify('⚠️ Please select a text layer first', { timeout: 2000 });
        figma.closePlugin();
        return;
    }

    var node = selection[0];
    var text = node.characters;

    // Find section context
    var section = findParentSection(node);
    var sectionContext = '';
    if (section) {
        sectionContext = collectSectionText(section, node.id);
    }

    // Build text with context
    var textToSend = text;
    if (sectionContext) {
        textToSend = '[Context from section]\n' + sectionContext + '\n\n[Continue this text]\n' + text;
    }

    figma.notify('✨ Generating...', { timeout: 10000 });

    // Make API request
    figma.showUI(__html__, { visible: false, width: 1, height: 1 });

    // Send request to UI for network access
    setTimeout(function () {
        figma.ui.postMessage({
            type: 'quick-generate',
            text: textToSend,
            nodeId: node.id
        });
    }, 100);
}

// Find parent Section of a node
function findParentSection(node) {
    var current = node.parent;
    while (current) {
        if (current.type === 'SECTION') {
            return current;
        }
        current = current.parent;
    }
    return null;
}

// Collect all text from a Section (excluding the selected node)
function collectSectionText(section, excludeNodeId) {
    var texts = [];

    function traverse(node) {
        if (node.type === 'TEXT' && node.id !== excludeNodeId) {
            if (node.characters && node.characters.trim()) {
                texts.push(node.characters.trim());
            }
        }
        if ('children' in node) {
            for (var i = 0; i < node.children.length; i++) {
                traverse(node.children[i]);
            }
        }
    }

    traverse(section);
    return texts.join('\n\n');
}

// Get selection info with section context
function getSelectionWithContext() {
    var selection = figma.currentPage.selection;

    if (selection.length === 0) {
        return { success: false, error: 'No layer selected. Please select a text layer.' };
    }

    var node = selection[0];

    if (node.type !== 'TEXT') {
        return { success: false, error: 'Selected layer is not a text layer.' };
    }

    var section = findParentSection(node);
    var sectionContext = '';
    var sectionName = '';

    if (section) {
        sectionContext = collectSectionText(section, node.id);
        sectionName = section.name;
    }

    return {
        success: true,
        text: node.characters,
        nodeId: node.id,
        nodeName: node.name,
        sectionContext: sectionContext,
        sectionName: sectionName
    };
}

// Listen for messages from the UI
figma.ui.onmessage = function (msg) {

    // Get text from selected layer
    if (msg.type === 'get-selected-text') {
        var result = getSelectionWithContext();
        figma.ui.postMessage({
            type: 'selection-result',
            success: result.success,
            error: result.error,
            text: result.text,
            nodeId: result.nodeId,
            nodeName: result.nodeName,
            sectionContext: result.sectionContext,
            sectionName: result.sectionName
        });
    }

    // Quick generate result
    if (msg.type === 'quick-result') {
        if (msg.success && msg.suggestion) {
            var node = figma.getNodeById(msg.nodeId);
            if (node && node.type === 'TEXT') {
                var fonts = node.getRangeAllFontNames(0, node.characters.length);
                var fontPromises = [];
                for (var i = 0; i < fonts.length; i++) {
                    fontPromises.push(figma.loadFontAsync(fonts[i]));
                }

                Promise.all(fontPromises).then(function () {
                    node.characters = node.characters + ' ' + msg.suggestion;
                    figma.notify('✨ Text added!', { timeout: 1500 });
                    figma.closePlugin();
                }).catch(function () {
                    figma.notify('⚠️ Failed to load fonts', { timeout: 2000 });
                    figma.closePlugin();
                });
            }
        } else {
            figma.notify('⚠️ Generation failed', { timeout: 2000 });
            figma.closePlugin();
        }
    }

    // Accept suggestion and update text
    if (msg.type === 'accept-suggestion') {
        var nodeId = msg.nodeId;
        var newText = msg.newText;

        var node = figma.getNodeById(nodeId);

        if (!node || node.type !== 'TEXT') {
            figma.ui.postMessage({
                type: 'accept-result',
                success: false,
                error: 'Text layer not found.'
            });
            return;
        }

        var fonts = node.getRangeAllFontNames(0, node.characters.length);
        var fontPromises = [];
        for (var i = 0; i < fonts.length; i++) {
            fontPromises.push(figma.loadFontAsync(fonts[i]));
        }

        Promise.all(fontPromises).then(function () {
            node.characters = newText;
            figma.ui.postMessage({ type: 'accept-result', success: true });
            figma.notify('✨ Text updated!', { timeout: 1500 });
        }).catch(function (error) {
            figma.ui.postMessage({
                type: 'accept-result',
                success: false,
                error: 'Failed to load fonts'
            });
        });
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

// Listen for selection changes (only in panel mode)
figma.on('selectionchange', function () {
    if (pluginMode !== 'panel') return;

    var result = getSelectionWithContext();
    if (result.success) {
        figma.ui.postMessage({
            type: 'selection-changed',
            hasTextSelected: true,
            success: result.success,
            text: result.text,
            nodeId: result.nodeId,
            nodeName: result.nodeName,
            sectionContext: result.sectionContext,
            sectionName: result.sectionName
        });
    } else {
        figma.ui.postMessage({
            type: 'selection-changed',
            hasTextSelected: false
        });
    }
});
