const vscode = require('vscode');

function TiddlersWebView() {
    let _webview, _metaWebView, _tiddlywikiAPI, _tiddlywikiEditor;
    let _extensionUri;
    function init({
        webview, extensionUri, tiddlywikiAPI, tiddlywikiEditor, metaWebviewRef
    }) {
        _webview = webview;
        _extensionUri = extensionUri;
        _tiddlywikiAPI = tiddlywikiAPI;
        _tiddlywikiEditor = tiddlywikiEditor;
        _metaWebView = metaWebviewRef;
    }
    function createView() {
        _webview.options = { enableScripts: true };
        _webview.html = getTiddlersWebviewContent(_webview, _extensionUri);

        // Load initial tiddlers when panel loads
        loadTiddlersIntoWebview();

        // Receive messages from tiddlers webview
        _webview.onDidReceiveMessage(async message => {
            if (message.command === 'search') {
                await searchTiddlers(message.text);
            } else if (message.command === 'refresh') {
                await loadTiddlersIntoWebview();
            } else if (message.command === 'selectTiddler') {
                // Optionally notify meta panel
                if (_metaWebView) _metaWebView.showMeta(message.tiddler);
            } else if (message.command === 'openTiddler') {
                await _tiddlywikiEditor.editTiddler(message.tiddler);
                if (_metaWebView) _metaWebView.showMeta(message.tiddler);
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

    async function loadTiddlersIntoWebview() {
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
            const results = await _tiddlywikiAPI.searchTiddlers(defaultFilter);
            if (results && results.success) {
                _webview.postMessage({
                    command: 'updateList',
                    items: results.data || [],
                    searchTerm: defaultFilter
                });
            }
        } catch (error) {
            console.error('Error loading tiddlers:', error);
        }
    }

    async function searchTiddlers(searchText) {
        try {
            if (!searchText || searchText.trim() === '') {
                return;
            }
            const results = await _tiddlywikiAPI.searchTiddlers(searchText);
            if (results && results.success) {
                _webview.postMessage({
                    command: 'updateList',
                    items: results.data || []
                });
            }
        } catch (error) {
            console.error('Error searching tiddlers:', error);
        }
    }
    return {
        init,
        createView,
        loadTiddlersIntoWebview
    }
}
module.exports = {
    TiddlersWebView
};
