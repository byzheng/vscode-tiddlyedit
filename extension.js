const vscode = require('vscode');
const { TiddlywikiAPI } = require('./tiddlywiki-api.js');
const { AutoComplete } = require('./src/autocomplete.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize TiddlyWiki API
let tiddlywikiAPI = null;
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

async function openTiddlerForEditing(tiddler, tempFolder) {
    try {
        const result = await tiddlywikiAPI.getTiddlerByTitle(tiddler.title);
        if (!result || !result.success) {
            vscode.window.showErrorMessage(`Could not fetch tiddler: ${tiddler.title}`);
            return;
        }

        const tiddlerData = result.data;
        const tmpFilePath = path.join(tempFolder, `${tiddlerData.title}.tid`);
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
        tempFiles.add(tmpFilePath);
        //selectedTiddler = message.tiddler;
        await updateMetaPanel(tiddler);
    } catch (error) {
        vscode.window.showErrorMessage(`Error opening tiddler: ${error.message}`);
    }
}

// async function refreshWebviewTiddlers(webview) {
//     try {
//         const latest = await tiddlywikiAPI.getLatestTiddlers();
//         if (latest && latest.success) {
//             webview.postMessage({ command: 'updateList', items: latest.data });
//         } else {
//             console.error('Could not fetch latest tiddlers');
//         }
//     } catch (error) {
//         console.error('Error refreshing webview:', error);
//     }
// }


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




    function hasRemoteTiddleDocument(doc) {
        if (!doc) {
            return false;
        }
        if (!/\.(rmd)$/i.test(doc.fileName)) {
            return false;
        }
        const text = doc.getText(new vscode.Range(0, 0, 30, 0));
        const headerMatch = /output:\s*\n\s*rtiddlywiki::tiddler_document:\s*\n\s*remote:\s*true/i.test(text);
        if (!headerMatch) {
            return false;
        }
        return true;
    }

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
    // Register Preview in TiddlyWiki for Rmd command
    context.subscriptions.push(
        vscode.commands.registerCommand("tiddlyedit.updateContext", () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const doc = editor.document;
            const hasRemote = hasRemoteTiddleDocument(doc);
            const isTempTid = isInTempDir(doc.fileName);
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

    context.subscriptions.push(
        vscode.commands.registerCommand('tiddlyedit.previewRmdInTiddlyWiki', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const doc = editor.document;

            const hasRemote = hasRemoteTiddleDocument(doc);
            const isTempTid = isInTempDir(doc.fileName);
            const isPreviewable = hasRemote || isTempTid;
            if (!isPreviewable) {
                vscode.window.showWarningMessage('This Rmd file is not previewable.');
                return;
            }

            let tiddlerTitle;
            if (hasRemote) {
                // Read first 30 lines for header
                const text = doc.getText(new vscode.Range(0, 0, 30, 0));

                let tiddlerTitleFromYaml = null;
                try {
                    const yamlMatch = text.match(/^---\s*([\s\S]*?)\n---/);
                    if (yamlMatch) {
                        const yamlBlock = yamlMatch[1];
                        const titleMatch = yamlBlock.match(/^\s*title:\s*["']?(.+?)["']?\s*$/m);
                        if (titleMatch) {
                            tiddlerTitleFromYaml = titleMatch[1].trim().replace(/^["']|["']$/g, "");
                        }
                    }
                } catch (e) {
                    vscode.window.setStatusBarMessage('Error parsing YAML front matter:' + e, 3000);
                    return;
                }
                if (!tiddlerTitleFromYaml || tiddlerTitleFromYaml === "" ||
                    tiddlerTitleFromYaml === "Untitled Document"
                ) {
                    vscode.window.setStatusBarMessage('No title found in YAML front matter.', 3000);
                    return;
                }
                tiddlerTitle = tiddlerTitleFromYaml;
            } else if (isTempTid) {
                tiddlerTitle = path.basename(doc.fileName, '.tid');
            }
            if (!tiddlerTitle) {
                vscode.window.showErrorMessage('Could not determine tiddler title from document.');
            }
            if (ws && ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                    type: "open-tiddler",
                    title: tiddlerTitle
                }));
                vscode.window.setStatusBarMessage(`Previewing '${tiddlerTitle}' in TiddlyWiki.`, 3000);
            } else {
                vscode.window.setStatusBarMessage('WebSocket is not connected.', 3000);
            }
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
                        await openTiddlerForEditing(message.tiddler, tempFolder);
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
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (!document || !document.fileName) return;
            if (!isInTempDir(document.fileName)) return; //ignore if not in temp dir
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
 // Cleanup all remaining temp files
    for (const filePath of tempFiles) {
        try {
            fs.unlinkSync(filePath);
        } catch (err) {
            console.error("Failed to delete temp file on deactivate:", err);
        }
    }
    tempFiles.clear();


}

module.exports = {
    activate,
    deactivate
};
