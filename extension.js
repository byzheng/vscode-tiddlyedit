const vscode = require('vscode');
const fetch = require('node-fetch');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Read TiddlyWiki host from configuration
const config = vscode.workspace.getConfiguration('tiddlywiki');
const tiddlywikiHost = config.get('host', 'http://127.0.0.1:8080');
const tiddlywikiRecipe = config.get('recipe', 'default');

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

async function fetchTiddlersFiltered(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        return []; // Return empty list if no search term
    }

    // Construct your REST API URL to search tiddlers by title or filter
    // This is an example URL, adjust to your TiddlyWiki API
    const url = `${tiddlywikiHost}/recipes/${tiddlywikiRecipe}/tiddlers.json?filter=[all[tiddlers]!is[system]search:title[${encodeURIComponent(searchTerm)}]]`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Failed to fetch tiddlers:', response.statusText);
            return [];
        }

        const tiddlers = await response.json();
        // tiddlers is an object keyed by tiddler titles, so get keys as titles
        return tiddlers;

    } catch (error) {
        console.error('Error fetching tiddlers:', error);
        return [];
    }
}

async function getTiddlerByTitle(title) {
    const url = `${tiddlywikiHost}/recipes/${tiddlywikiRecipe}/tiddlers/${encodeURIComponent(title)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Failed to fetch tiddler:', response.statusText);
            return null;
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching tiddler:', error);
        return null;
    }
}

function activate(context) {
    context.subscriptions.push(
        
        vscode.window.registerWebviewViewProvider('tiddlywiki-webview', {
            resolveWebviewView(webviewView) {
                webviewView.webview.options = {
                    enableScripts: true
                };
                webviewView.webview.html = getWebviewContent(webviewView.webview, context.extensionUri);
                
                // Receive messages from webview
                webviewView.webview.onDidReceiveMessage(async message => {
                    console.log('Received message from webview:', message);
                    if (message.command === 'search') {
                        // call your REST API, filter tiddlers, and send results back
                        const results = await fetchTiddlersFiltered(message.text);
                        webviewView.webview.postMessage({ command: 'updateList', items: results });
                    }
                    if (message.command === 'openTiddler') {
                        const tiddler = await getTiddlerByTitle(message.item.title);
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
        const title = path.basename(document.fileName, '.tid');

        const newText = document.getText();
        const tiddler = await getTiddlerByTitle(title);

        if (!tiddler) {
            vscode.window.showWarningMessage('Cannot find the original tiddler to save changes.');
            return;
        }

        // Merge new text into original tiddler fields
        const updatedTiddler = {
            ...tiddler,
            text: newText
        };

        const url = `${tiddlywikiHost}/recipes/${tiddlywikiRecipe}/tiddlers/${encodeURIComponent(tiddler.title)}`;

        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    "x-requested-with": "TiddlyWiki"
                },
                body: JSON.stringify(updatedTiddler)
            });

            if (!response.ok) {
                throw new Error(`Failed to save: ${response.statusText}`);
            }

            vscode.window.showInformationMessage(`✅ Tiddler "${tiddler.title}" saved.`);
        } catch (err) {
            console.error('Save error:', err);
            vscode.window.showErrorMessage(`❌ Could not save "${tiddler.title}": ${err.message}`);
        }
    });


}


function deactivate() { }

module.exports = {
    activate,
    deactivate
};
