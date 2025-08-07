const vscode = require('vscode');
const { TiddlywikiAPI } = require('./tiddlywiki-api.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize TiddlyWiki API
let tiddlywikiAPI = null;

function initializeAPI() {
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    const host = config.get('host', 'http://127.0.0.1:8080');
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

function activate(context) {
    // Initialize the API
    initializeAPI();
    
    context.subscriptions.push(
        
        vscode.window.registerWebviewViewProvider('tiddlywiki-webview', {
            resolveWebviewView(webviewView) {
                webviewView.webview.options = {
                    enableScripts: true
                };
                webviewView.webview.html = getWebviewContent(webviewView.webview, context.extensionUri);
                // Fetch and display latest tiddlers when the panel loads
                (async () => {
                    const latest = await tiddlywikiAPI.getLatestTiddlers();
                    if (latest && latest.success) {
                        webviewView.webview.postMessage({ command: 'updateList', items: latest.data });
                    } else {
                        vscode.window.showErrorMessage('Could not fetch latest tiddlers.');
                    }
                })();
                //webviewView.webview.postMessage({ command: 'updateList', items: latest });
                // Receive messages from webview
                webviewView.webview.onDidReceiveMessage(async message => {
                    if (message.command === 'search') {
                        // call your REST API, filter tiddlers, and send results back
                        const results = await tiddlywikiAPI.searchTiddlers(message.text);
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
                        console.log('Opening tiddler:', tiddler);
                        
                        const tmpFilePath = path.join(os.tmpdir(), `${tiddler.title}.tid`);
                        fs.writeFileSync(tmpFilePath, tiddler.text || '', 'utf8');

                        const titledDoc = await vscode.workspace.openTextDocument(tmpFilePath);
                        await vscode.languages.setTextDocumentLanguage(titledDoc, "plaintext"); // ensure it's a valid VSCode language
                        await vscode.window.showTextDocument(titledDoc);

                        return;
                    }
                });
            }
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
            
            const existingTiddler = existingResult.data;
            
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
                ...existingTiddler,
                text: newText,
                modified: getTiddlyWikiModifiedDate()
            };
            
            // Save back to TiddlyWiki using PUT request
            const saveResult = await tiddlywikiAPI.putTiddler(title, existingTiddler.tags || [], updatedFields);
            
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
