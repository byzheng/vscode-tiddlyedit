const vscode = require('vscode');
const { TiddlywikiAPI } = require('./src/tiddlywiki-api.js');
const { TiddlywikiEditor } = require('./src/tiddlywiki-editor.js');
const { AutoComplete } = require('./src/autocomplete.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize TiddlyWiki API
let tiddlywikiAPI = null;
let tiddlywikiEditor = TiddlywikiEditor();
let tiddlersWebview = null;
let metaWebview = null;
let selectedTiddler = null;
let ws = null;
const tempFiles = new Set();

let tiddlywikiTags = [];


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

async function getTiddlyWikiTags() {
    const result = await tiddlywikiAPI.getTiddlersByFilter("[all[tiddlers]is[tag]!is[system]!is[shadow]]");
    if (result && result.success && Array.isArray(result.data)) {
        tiddlywikiTags = result.data;
        console.log(tiddlywikiTags);
    }
}

let reconnectAttempts = 0;
const maxReconnectDelay = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

function connectWebSocket(tempFolder, reconnect = false) {
    if (reconnect && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn("Max reconnect attempts reached. Stopping.");
        return;
    }
    console.log('Connecting to TiddlyWiki WebSocket...');
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    let host = getTiddlyWikiHost();
    host = host.replace(/^https?:\/\//, '');

    if (ws) {
        if (ws.readyState !== WebSocket.CLOSED && reconnect) {
            console.log('Closing existing WebSocket before reconnect');
            ws.close(1000, 'Reconnecting');  // Normal closure code
            ws = null;
        } else if (ws.readyState === WebSocket.OPEN) {
            // Already connected
            return ws;
        }
    }

    ws = new WebSocket(`ws://${host}/ws`);

    ws.onopen = () => {
        console.log('WebSocket connection established');
        reconnectAttempts = 0;  // Reset on success
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'edit-tiddler') {
                (async () => {
                    try {
                        await openTiddlerForEditing(data, tempFolder);
                    } catch (e) {
                        console.error('Error opening tiddler:', e);
                    }
                })();
            }
        } catch (e) {
            console.error('Error parsing WebSocket message:', e);
        }
    };

    ws.onclose = (event) => {
        console.log(`WebSocket closed (code: ${event.code}, reason: ${event.reason})`);
        if (event.code !== 1000) {  // 1000 means normal closure; only reconnect if abnormal
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay);
            console.warn(`WebSocket disconnected. Reconnecting in ${delay / 1000}s...`);
            setTimeout(() => connectWebSocket(tempFolder, true), delay);
        } else {
            console.log('WebSocket closed normally, will not reconnect.');
        }
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };

    return ws;
}


// Detect system wake using timer
let lastTick = Date.now();
setInterval(() => {
    const now = Date.now();
    if (now - lastTick > 10000) { // system was asleep/paused > 10s
        console.log("System wake detected, checking WS connection...");
        if (!ws || ws.readyState === WebSocket.CLOSED) {
            connectWebSocket(tempFolder, true);
        }
    }
    lastTick = now;
}, 5000);


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
        const _defaultFilter = '[all[tiddlers]!is[system]!is[shadow]!sort[modified]limit[10]]';
        const config = vscode.workspace.getConfiguration('tiddlywiki');
        const defaultFilter = config.get('defaultfilter');

        if (!defaultFilter || typeof defaultFilter !== 'string') {
            vscode.window.showErrorMessage('Invalid default filter configuration');
            return;
        }
        if (defaultFilter.trim() === "") {
            defaultFilter = _defaultFilter;
        }
        //console.log('Loading tiddlers with filter:', defaultFilter);
        const results = await tiddlywikiAPI.searchTiddlers(defaultFilter);
        if (results && results.success) {
            tiddlersWebview.postMessage({
                command: 'updateList',
                items: results.data || [],
                searchTerm: defaultFilter
            });
        }
        getTiddlyWikiTags();
    } catch (error) {
        console.error('Error loading tiddlers:', error);
    }
}

async function searchTiddlers(searchText) {
    if (!tiddlersWebview) return;

    try {
        if (!searchText || searchText.trim() === '') {
            return;
        }
        const results = await tiddlywikiAPI.searchTiddlers(searchText);
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


function activate(context) {

    // Initialize the API
    initializeAPI();
    const tempFolder = path.join(os.tmpdir(), 'tiddlyedit-temp');
    // Create it once if it doesn’t exist
    if (!fs.existsSync(tempFolder)) {
        fs.mkdirSync(tempFolder);
    }

    connectWebSocket(tempFolder);

    let autoComplete = AutoComplete();

    // Initialize autocomplete configuration
    (async () => {
        try {
            await autoComplete.loadConfigure(tiddlywikiAPI);
        } catch (error) {
            console.error('Failed to load autocomplete configuration:', error);
        }
    })();


    // Register Preview in TiddlyWiki for Rmd command
    context.subscriptions.push(
        vscode.commands.registerCommand("tiddlyedit.updateContext", () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const doc = editor.document;
            const hasRemote = tiddlywikiEditor.hasRemoteTiddleDocument(doc);
            const isTempTid = tiddlywikiEditor.isInTempDir(doc.fileName);
            const isPreviewable = hasRemote || isTempTid;
            vscode.commands.executeCommand("setContext", "tiddlyedit.isPreviewable", isPreviewable);
        })
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            vscode.commands.executeCommand("tiddlyedit.updateContext");
        })
    );
    vscode.commands.executeCommand("tiddlyedit.updateContext");

    // Register Preview in TiddlyWiki for Rmd command
    context.subscriptions.push(
        vscode.commands.registerCommand('tiddlyedit.previewRmdInTiddlyWiki', async () => {
            await tiddlywikiEditor.previewRmd(ws);
        })
    );

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
                connectWebSocket(tempFolder, true);

                // Refresh webview if it's open
                if (currentWebview) {
                    loadTiddlersIntoWebview();
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
                        //selectedTiddler = message.tiddler;
                        //await updateMetaPanel(message.tiddler);
                    } else if (message.command === 'openTiddler') {
                        await tiddlywikiEditor.editTiddler(message.tiddler, tiddlywikiAPI);
                        await updateMetaPanel(message.tiddler);
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
                webviewView.webview.onDidReceiveMessage(async message => {
                    if (message.command === 'openTiddlerInTiddlywiki') {
                        sendOpenTiddlerToWebSocket(message.tiddler);
                    } else if (message.command === 'updateTiddlerTags') {
                        // Save updated tags to TiddlyWiki
                        const { title, tags } = message;
                        try {
                            const result = await tiddlywikiAPI.getTiddlerByTitle(title);
                            if (result && result.success) {
                                const tiddler = result.data;
                                tiddler.tags = tags;
                                // Save back
                                const saveResult = await tiddlywikiAPI.putTiddler(title, [], tiddler);
                                if (saveResult && saveResult.success) {
                                    vscode.window.setStatusBarMessage(`Tags updated for '${title}'`, 2000);
                                    // Refresh meta panel
                                    // await updateMetaPanel(tiddler);
                                    // Update the tiddler list
                                    // await loadTiddlersIntoWebview();
                                } else {
                                    vscode.window.showWarningMessage('Failed to update tags in TiddlyWiki.');
                                }
                            }
                        } catch (e) {
                            vscode.window.showErrorMessage('Error updating tags: ' + e.message);
                        }
                    }
                });
            }
        })
    );
    function sendOpenTiddlerToWebSocket(tiddler) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "open-tiddler",
                title: tiddler.title
            }));
        } else {
            vscode.window.showWarningMessage('WebSocket is not connected.');
        }
    }
    // Auto complete 
    context.subscriptions.push(
        vscode.commands.registerCommand('tiddlyedit.insertAutocomplete', async () => {
            autoComplete.showQuickPick(tiddlywikiAPI);
        })
    );
    // Save tiddler on document save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            await tiddlywikiEditor.saveTiddler(document, tiddlywikiAPI);
        })
    );

    // context.subscriptions.push(
    //     vscode.window.onDidChangeVisibleTextEditors((editors) => {
    //         const openDocs = new Set(editors.map(e => e.document.fileName));
    //         for (const filePath of tempFiles) {
    //             if (openDocs.has(filePath)) {
    //                 continue;
    //             }
    //             fs.unlink(filePath, (err) => {
    //                 if (err) console.error("Failed to delete temp file:", err);
    //                 else console.log("Deleted temp file:", filePath);
    //             });
    //             tempFiles.delete(filePath);
    //         }
    //     })
    // );

}


function deactivate() {
    tiddlywikiEditor.clearTempFiles();
    if (ws) {
        ws.close(1000, 'Extension deactivated');
    }
}

module.exports = {
    activate,
    deactivate
};
