const vscode = require('vscode');
const { TiddlywikiAPI } = require('./tiddlywiki-api.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize TiddlyWiki API
let tiddlywikiAPI = null;
let currentWebview = null;

function getTiddlyWikiHost() {
    // Use environment variable in debug mode, otherwise use user config
    if (process.env.TIDDLYWIKI_HOST_TEST) {
        return process.env.TIDDLYWIKI_HOST_TEST;
    }
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    return config.get('host', 'http://127.0.0.1:8080');
}

function initializeAPI() {
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    const host = getTiddlyWikiHost();
    const recipe = config.get('recipe', 'default');
    tiddlywikiAPI = TiddlywikiAPI(host, recipe);
    return tiddlywikiAPI;
}

function getWebviewContent(webview, extensionUri) {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'script.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
    );
    return `
    <div style="display: flex; align-items: center;">
        <input type="text" id="tw-search" placeholder="Search tiddlers..." style="flex:1;" />
        <button id="tw-refresh" title="Refresh" style="margin-left: 8px;">&#x21bb;</button>
    </div>
    <ul id="tw-tiddler-list"></ul>
    <script src="${scriptUri}"></script>
    <link rel="stylesheet" type="text/css" href="${styleUri}" />
    `;
}

async function refreshWebviewTiddlers(webview) {
    try {
        const latest = await tiddlywikiAPI.getLatestTiddlers();
        if (latest && latest.success) {
            webview.postMessage({ command: 'updateList', items: latest.data });
        } else {
            console.error('Could not fetch latest tiddlers');
        }
    } catch (error) {
        console.error('Error refreshing webview:', error);
    }
}


function activate(context) {
    // Initialize the API
    initializeAPI();

    const tempFolder = path.join(os.tmpdir(), 'tiddlyedit-temp');
    // Create it once if it doesn’t exist
    if (!fs.existsSync(tempFolder)) {
        fs.mkdirSync(tempFolder);
    }
    let autoCompleteConfigure;
    tiddlywikiAPI.getAutoCompleteConfigure().then(conf => {
        autoCompleteConfigure = conf;
    });

    function isInTempDir(filePath) {
        try {
            let realTempDir = fs.realpathSync(tempFolder);
            let realFile = fs.realpathSync(filePath);
            // On Windows, ignore case sensitivity
            if (process.platform === 'win32') {
                realTempDir = realTempDir.toLowerCase();
                realFile = realFile.toLowerCase();
            }
            return realFile.startsWith(realTempDir + path.sep);
        } catch {
            return false; // In case either path doesn't exist
        }
    }


    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration('tiddlywiki')) {

                // Get all open editors, not just visible ones

                const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
                for (const tab of tabs) {
                    if (
                        tab.input &&
                        tab.input.uri &&
                        typeof tab.input.uri.fsPath === 'string' &&
                        tab.input.uri.fsPath.endsWith('.tid') &&
                        isInTempDir(tab.input.uri.fsPath)
                    ) {
                        await vscode.window.tabGroups.close(tab);
                    }
                }

                // Reinitialize API with new settings
                initializeAPI();

                // Refresh webview if it's open
                if (currentWebview) {
                    refreshWebviewTiddlers(currentWebview);
                }
                vscode.window.showInformationMessage('TiddlyWiki configuration updated!');
            }
        })
    );

    context.subscriptions.push(

        vscode.window.registerWebviewViewProvider('tiddlywiki-webview', {
            resolveWebviewView(webviewView) {
                currentWebview = webviewView.webview; // Store reference

                webviewView.webview.options = {
                    enableScripts: true
                };
                webviewView.webview.html = getWebviewContent(webviewView.webview, context.extensionUri);

                // Fetch and display latest tiddlers when the panel loads
                refreshWebviewTiddlers(currentWebview);
                //webviewView.webview.postMessage({ command: 'updateList', items: latest });
                // Receive messages from webview
                webviewView.webview.onDidReceiveMessage(async message => {
                    if (message.command === 'search') {
                        let results;
                        if (message.text === undefined || message.text === null || message.text === '') {
                            results = await tiddlywikiAPI.getLatestTiddlers();
                        } else {
                            results = await tiddlywikiAPI.searchTiddlers(message.text);
                        }
                        if (!results || !results.success) {
                            vscode.window.showErrorMessage(`Could not search tiddlers by: ${message.text}`);
                            return;
                        }
                        webviewView.webview.postMessage({ command: 'updateList', items: results.data });
                    }
                    if (message.command === 'openTiddler') {
                        const result = await tiddlywikiAPI.getTiddlerByTitle(message.item.title);
                        if (!result || !result.success) {
                            vscode.window.showErrorMessage(`Could not fetch tiddler: ${message.item.title}`);
                            return;
                        }
                        const tiddler = result.data;
                        if (!tiddler) {
                            vscode.window.showErrorMessage(`Could not fetch tiddler: ${message.item.title}`);
                            return;
                        }
                        // console.log('Opening tiddler:', tiddler);

                        const tmpFilePath = path.join(tempFolder, `${tiddler.title}.tid`);
                        fs.writeFileSync(tmpFilePath, tiddler.text || '', 'utf8');


                        let language = "tiddlywiki5";
                        if (tiddler.type === "application/javascript") language = "javascript";
                        else if (tiddler.type === "text/css") language = "css";
                        else if (tiddler.type === "application/json") language = "json";
                        else if (tiddler.type === "text/html") language = "html";
                        else if (tiddler.type === "text/markdown" || tiddler.type === "text/x-markdown") language = "markdown";
                        else if (tiddler.type === "text/vnd.tiddlywiki") language = "tiddlywiki5";
                        else language = "text";
                        console.log('Opening tiddler with language:', language);
                        const titledDoc = await vscode.workspace.openTextDocument(tmpFilePath);

                        if (language) {
                            await vscode.languages.setTextDocumentLanguage(titledDoc, language);
                        }
                        await vscode.window.showTextDocument(titledDoc);

                        return;
                    }
                });
            }
        })
    );
    function getAutoTrigger(value) {
        if (!autoCompleteConfigure || !Array.isArray(autoCompleteConfigure)) {
            return null;
        }
        for (const conf of autoCompleteConfigure) {
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
    async function getAutoCompleteOptions(value) {
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
    // Auto complete 
    context.subscriptions.push(
        vscode.commands.registerCommand('tiddlyedit.insertAutocomplete', async () => {
            const quickPick = vscode.window.createQuickPick();
            quickPick.placeholder = "Type at least 2 chars for suggestions...";
            quickPick.matchOnDescription = true; // better filtering
            quickPick.matchOnDetail = true;

            let currentTrigger = null; // store trigger/search state

            quickPick.onDidChangeValue(async (value) => {
                if (value.length < 2) {
                    return [];
                }
                const optionsData = await getAutoCompleteOptions(value);

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

            quickPick.onDidAccept(() => {
                const selection = quickPick.selectedItems[0];
                if (selection) {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        return;
                    }
                    let snippet;

                    if (currentTrigger && currentTrigger.template) {
                        console.log('Using template for snippet:', currentTrigger.template);
                        console.log('Selected option:', selection.label);
                        const caretIndex = currentTrigger.template.indexOf("$caret$");
                        snippet = currentTrigger.template
                            .replace("$option$", selection.label)
                            .replace("$caret$", "$0");
                    } else {
                        snippet = `[[${selection.label}]] `;
                    }

                    editor.insertSnippet(new vscode.SnippetString(snippet));
                }
                quickPick.hide();
            });

            quickPick.show();
        })
    );

    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (!document.fileName.endsWith('.tid')) return;

        if (!tiddlywikiAPI) initializeAPI();

        const title = path.basename(document.fileName, '.tid');
        const newText = document.getText();

        try {
            // Get existing tiddler to preserve other fields
            const existingResult = await tiddlywikiAPI.getTiddlerByTitle(title);

            if (!existingResult || !existingResult.success) {
                vscode.window.showWarningMessage('Cannot find the original tiddler to save changes.');
                return;
            }

            //const existingTiddler = existingResult.data;

            // Create updated tiddler with new text
            // Format date as [UTC]YYYY0MM0DD0hh0mm0ss0XXX
            function getTiddlyWikiModifiedDate() {
                const now = new Date();
                const pad = n => n.toString().padStart(2, '0');
                const year = now.getUTCFullYear();
                const month = pad(now.getUTCMonth() + 1);
                const day = pad(now.getUTCDate());
                const hour = pad(now.getUTCHours());
                const min = pad(now.getUTCMinutes());
                const sec = pad(now.getUTCSeconds());
                const ms = now.getUTCMilliseconds().toString().padStart(3, '0');
                return `${year}${month}${day}${hour}${min}${sec}${ms}`;
            }

            const updatedFields = {
                text: newText,
                modified: getTiddlyWikiModifiedDate()
            };

            // Save back to TiddlyWiki using PUT request
            const saveResult = await tiddlywikiAPI.putTiddler(title, [], updatedFields);

            if (saveResult && saveResult.success) {
                vscode.window.setStatusBarMessage(`✅ Tiddler "${title}" saved`, 3000); // shows for 3 seconds
            } else {
                throw new Error(saveResult?.error?.message || 'Unknown save error');
            }

        } catch (err) {
            console.error('Save error:', err);
            vscode.window.showErrorMessage(`❌ Could not save "${title}": ${err.message}`);
        }
    });


}


function deactivate() { }

module.exports = {
    activate,
    deactivate
};
