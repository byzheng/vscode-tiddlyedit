const vscode = require('vscode');
const fetch = require('node-fetch');
// Read TiddlyWiki host from configuration
const config = vscode.workspace.getConfiguration('tiddlywiki');
const tiddlywikiHost = config.get('host', 'http://127.0.0.1:8080');


function getWebviewContent() {
    return `
    <input type="text" id="tw-search" placeholder="Search tiddlers..." />
<ul id="tw-tiddly-list"></ul>

<script>
    const vscode = acquireVsCodeApi();

    document.getElementById('search').addEventListener('input', e => {
    vscode.postMessage({ command: 'search', text: e.target.value });
    });

    window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'updateList') {
        const ul = document.getElementById('list');
        ul.innerHTML = '';
        for (const title of message.items) {
        const li = document.createElement('li');
        li.textContent = title;
        li.onclick = () => {
            vscode.postMessage({ command: 'openTiddler', title });
        };
        ul.appendChild(li);
        }
    }
    });
</script>
    `;
}


function activate(context) {
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('tiddlywiki-webview', {
            resolveWebviewView(webviewView) {
                webviewView.webview.options = {
                    enableScripts: true
                };
                webviewView.webview.html = getWebviewContent();

                // Receive messages from webview
                webviewView.webview.onDidReceiveMessage(async message => {
                    if (message.command === 'search') {
                        // call your REST API, filter tiddlers, and send results back
                        const results = await fetchTiddlersFiltered(message.text);
                        webviewView.webview.postMessage({ command: 'updateList', items: results });
                    }
                    if (message.command === 'openTiddler') {
                        const doc = await vscode.workspace.openTextDocument({ content: message.content, language: 'plaintext' });
                        await vscode.window.showTextDocument(doc);
                    }
                });
            }
        })
    );
}


function deactivate() { }

module.exports = {
    activate,
    deactivate
};
