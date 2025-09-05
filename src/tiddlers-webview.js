const vscode = require('vscode');

function TiddlersWebView() {
    let webviewInstance = null;
    function initView(webview, extensionUri, tiddlywikiAPI, tiddlywikiEditor, metaWebviewRef) {
        //const webview = webviewView.webview;
        webviewInstance = webview;
        webview.options = { enableScripts: true };
        webview.html = getTiddlersWebviewContent(webview, extensionUri);

        // Load initial tiddlers when panel loads
        loadTiddlersIntoWebview(tiddlywikiAPI);

        // Receive messages from tiddlers webview
        webview.onDidReceiveMessage(async message => {
            if (message.command === 'search') {
                await searchTiddlers(tiddlywikiAPI, message.text);
            } else if (message.command === 'refresh') {
                await loadTiddlersIntoWebview(tiddlywikiAPI);
            } else if (message.command === 'selectTiddler') {
                // Optionally notify meta panel
                if (metaWebviewRef) metaWebviewRef.showMeta(message.tiddler);
            } else if (message.command === 'openTiddler') {
                await tiddlywikiEditor.editTiddler(message.tiddler, tiddlywikiAPI);
                if (metaWebviewRef) metaWebviewRef.showMeta(message.tiddler);
            }
        });
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

    async function loadTiddlersIntoWebview(tiddlywikiAPI) {
        try {
            const _defaultFilter = '[all[tiddlers]!is[system]!is[shadow]!sort[modified]limit[10]]';
            const config = vscode.workspace.getConfiguration('tiddlywiki');
            let defaultFilter = config.get('defaultfilter');
            if (!defaultFilter || typeof defaultFilter !== 'string') {
                vscode.window.showErrorMessage('Invalid default filter configuration');
                return;
            }
            if (defaultFilter.trim() === "") {
                defaultFilter = _defaultFilter;
            }
            const results = await tiddlywikiAPI.searchTiddlers(defaultFilter);
            if (results && results.success) {
                webviewInstance.postMessage({
                    command: 'updateList',
                    items: results.data || [],
                    searchTerm: defaultFilter
                });
            }
        } catch (error) {
            console.error('Error loading tiddlers:', error);
        }
    }

    async function searchTiddlers(tiddlywikiAPI, searchText) {
        try {
            if (!searchText || searchText.trim() === '') {
                return;
            }
            const results = await tiddlywikiAPI.searchTiddlers(searchText);
            if (results && results.success) {
                webviewInstance.postMessage({
                    command: 'updateList',
                    items: results.data || []
                });
            }
        } catch (error) {
            console.error('Error searching tiddlers:', error);
        }
    }
    return {

        initView,
        loadTiddlersIntoWebview
    }
}
module.exports = {
    TiddlersWebView
};
