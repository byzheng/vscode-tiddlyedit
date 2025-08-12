const vscode = require('vscode');
const { TiddlywikiAPI } = require('./tiddlywiki-api.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize TiddlyWiki API
let tiddlywikiAPI = null;
let tiddlersWebview = null;
let metaWebview = null;
let selectedTiddler = null;
let ws = null;

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



function connectWebSocket(reconnect = false) {
    console.log('Connecting to TiddlyWiki WebSocket...');
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    let host = getTiddlyWikiHost();
    // Remove protocol if present (http:// or https://)
    host = host.replace(/^https?:\/\//, '');
    if (ws && ws.readyState !== WebSocket.CLOSED && reconnect) {
        ws.close();
        ws = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    ws = new WebSocket(`ws://${host}/ws`);
    ws.onopen = () => {
        console.log('WebSocket connection established');
    };
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        if (data.type === 'edit-tiddler') {
            // Open tiddler for editing in the editor
            (async () => {
                await openTiddlerForEditing(data);
            })();
        }
    };
    ws.onclose = () => {
        console.log('WebSocket closed, attempting reconnect in 3s...');
        //setTimeout(() => connectWebSocket(true), 3000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };

    return ws;
}

function getTiddlersWebviewContent(webview, extensionUri) {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'tiddlers-script.js')
    );
    const sharedUtilsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'shared-utils.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
    );
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" type="text/css" href="${styleUri}" />
        <title>TiddlyWiki Tiddlers</title>
    </head>
    <body>
        <div class="search-container">
            <input type="text" id="tw-search" placeholder="Search tiddlers..." />
            <button id="tw-refresh" title="Refresh">🔄</button>
        </div>
        <ul id="tw-tiddler-list"></ul>
        <script src="${sharedUtilsUri}"></script>
        <script src="${scriptUri}"></script>
    </body>
    </html>`;
}

function getMetaWebviewContent(webview, extensionUri) {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'meta-script.js')
    );
    const sharedUtilsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'shared-utils.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
    );
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" type="text/css" href="${styleUri}" />
        <title>TiddlyWiki Meta</title>
    </head>
    <body>
        <div id="meta-container">
            <div id="no-selection">Select a tiddler to view its metadata</div>
            <div id="meta-content" style="display: none;"></div>
        </div>
        <script src="${sharedUtilsUri}"></script>
        <script src="${scriptUri}"></script>
    </body>
    </html>`;
}

async function loadTiddlersIntoWebview() {
    if (!tiddlersWebview) return;

    try {
        const results = await tiddlywikiAPI.getLatestTiddlers();
        if (results && results.success) {
            tiddlersWebview.postMessage({
                command: 'updateList',
                items: results.data || []
            });
        }
    } catch (error) {
        console.error('Error loading tiddlers:', error);
    }
}

async function searchTiddlers(searchText) {
    if (!tiddlersWebview) return;

    try {
        let results;
        if (!searchText || searchText.trim() === '') {
            results = await tiddlywikiAPI.getLatestTiddlers();
        } else {
            results = await tiddlywikiAPI.searchTiddlers(searchText);
        }

        if (results && results.success) {
            tiddlersWebview.postMessage({
                command: 'updateList',
                items: results.data || []
            });
        }
    } catch (error) {
        console.error('Error searching tiddlers:', error);
    }
}

async function updateMetaPanel(tiddler) {
    if (!metaWebview) return;

    try {
        const result = await tiddlywikiAPI.getTiddlerByTitle(tiddler.title);
        if (result && result.success) {
            metaWebview.postMessage({
                command: 'showMeta',
                tiddler: result.data
            });
        }
    } catch (error) {
        console.error('Error updating meta panel:', error);
    }
}

async function openTiddlerForEditing(tiddler) {
    try {
        const result = await tiddlywikiAPI.getTiddlerByTitle(tiddler.title);
        if (!result || !result.success) {
            vscode.window.showErrorMessage(`Could not fetch tiddler: ${tiddler.title}`);
            return;
        }

        const tiddlerData = result.data;
        const tmpFilePath = path.join(os.tmpdir(), `${tiddlerData.title}.tid`);
        fs.writeFileSync(tmpFilePath, tiddlerData.text || '', 'utf8');

        let language = "tiddlywiki5";
        if (tiddlerData.type === "application/javascript") language = "javascript";
        else if (tiddlerData.type === "text/css") language = "css";
        else if (tiddlerData.type === "application/json") language = "json";
        else if (tiddlerData.type === "text/html") language = "html";
        else if (tiddlerData.type === "text/markdown" || tiddlerData.type === "text/x-markdown") language = "markdown";
        else if (tiddlerData.type === "text/vnd.tiddlywiki") language = "tiddlywiki5";
        else language = "text";

        const doc = await vscode.workspace.openTextDocument(tmpFilePath);
        await vscode.languages.setTextDocumentLanguage(doc, language);
        await vscode.window.showTextDocument(doc);

    } catch (error) {
        vscode.window.showErrorMessage(`Error opening tiddler: ${error.message}`);
    }
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
    connectWebSocket();

    const tempFolder = path.join(os.tmpdir(), 'tiddlyedit-temp');
    // Create it once if it doesn’t exist
    if (!fs.existsSync(tempFolder)) {
        fs.mkdirSync(tempFolder);
    }
    let autoCompleteConfigure;


    // Initialize autocomplete configuration
    (async () => {
        try {
            autoCompleteConfigure = await tiddlywikiAPI.getAutoCompleteConfigure();
        } catch (error) {
            console.error('Failed to load autocomplete configuration:', error);
        }
    })();


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
                // reconnect WebSocket
                connectWebSocket(true);

                // Refresh webview if it's open
                if (currentWebview) {
                    refreshWebviewTiddlers(currentWebview);
                }
                vscode.window.showInformationMessage('TiddlyWiki configuration updated!');
            }
        })
    );

    context.subscriptions.push(
        // Tiddlers webview provider
        vscode.window.registerWebviewViewProvider('tiddlywiki-tiddlers', {
            resolveWebviewView(webviewView) {
                tiddlersWebview = webviewView.webview;

                webviewView.webview.options = {
                    enableScripts: true
                };
                webviewView.webview.html = getTiddlersWebviewContent(webviewView.webview, context.extensionUri);

                // Load initial tiddlers when panel loads
                loadTiddlersIntoWebview();

                // Receive messages from tiddlers webview
                webviewView.webview.onDidReceiveMessage(async message => {
                    if (message.command === 'search') {
                        await searchTiddlers(message.text);
                    } else if (message.command === 'refresh') {
                        await loadTiddlersIntoWebview();
                    } else if (message.command === 'selectTiddler') {
                        // Update selected tiddler and notify meta panel
                        selectedTiddler = message.tiddler;
                        await updateMetaPanel(message.tiddler);
                    } else if (message.command === 'openTiddler') {
                        await openTiddlerForEditing(message.tiddler);
                    }
                });
            }
        }),

        // Meta webview provider
        vscode.window.registerWebviewViewProvider('tiddlywiki-meta', {
            resolveWebviewView(webviewView) {
                metaWebview = webviewView.webview;

                webviewView.webview.options = {
                    enableScripts: true
                };
                webviewView.webview.html = getMetaWebviewContent(webviewView.webview, context.extensionUri);

                // Show initial empty state
                metaWebview.postMessage({ command: 'clearMeta' });
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
