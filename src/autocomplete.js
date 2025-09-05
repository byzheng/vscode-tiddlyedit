const vscode = require('vscode');

function AutoComplete() {
    let _autoCompleteConfigure = null;
    async function loadConfigure(tiddlywikiAPI) {
        try {
            _autoCompleteConfigure = await tiddlywikiAPI.getAutoCompleteConfigure();
        } catch (error) {
            console.error('Failed to load autocomplete configuration:', error);
        }
    }
    function getAutoTrigger(value) {
        if (!_autoCompleteConfigure || !Array.isArray(_autoCompleteConfigure)) {
            return null;
        }
        for (const conf of _autoCompleteConfigure) {
            if (!conf || typeof conf.trigger !== 'string' || conf.trigger === '') {
                continue;
            }
            if (!value.startsWith(conf.trigger)) {
                continue; // not matching this trigger
            }
            return conf;
        }
        return null
    }
    async function getAutoCompleteOptions(tiddlywikiAPI, value) {
        if (typeof value !== "string" || value.length < 2) {
            return [];
        }
        let options = [];
        const autoTrigger = getAutoTrigger(value);
        if (autoTrigger) {
            // If we have a trigger, use it to get options
            options = await tiddlywikiAPI.getAutoCompleteOptions(autoTrigger, value);
        } else {
            options = await tiddlywikiAPI.searchTiddlers(value);
        }
        if (!options || !options.success) {
            return [];
        }
        return {
            trigger: autoTrigger,
            options: options.data
        };
    }
    async function showQuickPick(tiddlywikiAPI) {
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = "Type at least 2 chars for suggestions...";
        quickPick.matchOnDescription = true; // better filtering
        quickPick.matchOnDetail = true;

        let currentTrigger = null; // store trigger/search state

        quickPick.onDidChangeValue(async (value) => {
            if (value.length < 2) {
                return [];
            }
            const optionsData = await getAutoCompleteOptions(tiddlywikiAPI, value);

            if (!optionsData || !optionsData.options || optionsData.options.length === 0) {
                quickPick.items = [];
                return;
            }
            currentTrigger = optionsData.trigger;
            quickPick.items = optionsData.options.map(opt => ({
                label: opt.title,
                alwaysShow: true, // <-- ensure it's not filtered by user input
            }));
        });

        quickPick.onDidAccept(async () => {
            const selection = quickPick.selectedItems[0];
            if (selection) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }
                let snippet;

                if (currentTrigger && currentTrigger.template) {
                    let transformedValue = selection.label;
                    if (currentTrigger['transform-filter'] &&
                        currentTrigger['transform-filter'] !== "") {
                        if (currentTrigger['transform-filter'].includes('get[text]')) {
                            // Try to extract the tiddler title from the filter
                            try {
                                const result = await tiddlywikiAPI.getTiddlerByTitle(selection.label);
                                if (result && result.success && result.data && typeof result.data.text === "string") {
                                    transformedValue = result.data.text;
                                }
                            } catch (e) {
                                vscode.window.setStatusBarMessage('Failed to get tiddler text: ' + e.message, 3000);
                            }
                        } else {
                            // Replace <currentTiddler> with selection.label
                            const filter = currentTrigger['transform-filter'].replace(/<currentTiddler>/g, "[" + selection.label + "]");
                            // Query TiddlyWiki for the transformed value

                            try {
                                const result = await tiddlywikiAPI.getTiddlersByFilter(filter);
                                if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
                                    transformedValue = result.data[0];
                                }
                            } catch (e) {
                                vscode.window.setStatusBarMessage('Failed to apply transform-filter: ' + e.message, 3000);
                            }
                        }
                    }
                    snippet = currentTrigger.template
                        .replace("$option$", transformedValue)
                        .replace("$caret$", "$0");
                } else {
                    snippet = `[[${selection.label}]] `;
                }

                editor.insertSnippet(new vscode.SnippetString(snippet));
            }
            quickPick.hide();
        });

        quickPick.show();
    }
    return {
        loadConfigure,
        getAutoCompleteOptions,
        showQuickPick
    };
}
module.exports = {
    AutoComplete
};
