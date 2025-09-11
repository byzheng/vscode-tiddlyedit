const vscode = require('vscode');


function MetaWebView() {
    let _webview;
    let _extensionUri;
    let _tiddlywikiAPI;
    let _tiddlywikiEditor;
    let _tiddlersWebview;
    let _wsManager;

    function init({
        webview, 
        extensionUri,
        tiddlywikiAPI,
        tiddlersWebview, 
        tiddlywikiEditor,
        wsManager
    }) {
        _webview = webview;
        _extensionUri = extensionUri;
        _tiddlywikiAPI = tiddlywikiAPI;
        _tiddlersWebview = tiddlersWebview;
        _tiddlywikiEditor = tiddlywikiEditor;
        _wsManager = wsManager;
    }
    function createView() {
        _webview.options = { enableScripts: true };
        _webview.html = getMetaWebviewContent(_webview, _extensionUri);
        _webview.postMessage({ command: 'clearMeta' });

        _webview.onDidReceiveMessage(async message => {
            if (message.command === 'openTiddlerInTiddlywiki') {
                if (_wsManager && _wsManager.sendOpenTiddlerToWebSocket) {
                    _wsManager.sendOpenTiddlerToWebSocket(message.tiddler);
                }
            } else if (message.command === 'updateTiddlerTags') {
                const { title, tags } = message;
                try {
                    const result = await _tiddlywikiAPI.getTiddlerByTitle(title);
                    if (result && result.success) {
                        const tiddler = result.data;
                        tiddler.tags = tags;
                        const saveResult = await _tiddlywikiAPI.putTiddler(title, [], tiddler);
                        if (saveResult && saveResult.success) {
                            vscode.window.setStatusBarMessage(`Tags updated for '${title}'`, 2000);
                            // Optionally refresh tiddler list
                            if (_tiddlersWebview && _tiddlersWebview.loadTiddlersIntoWebview) {
                                _tiddlersWebview.loadTiddlersIntoWebview();
                            }
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

    function showMeta(tiddler) {
        if (!_webview) return;
        if (!tiddler) return;
        _webview.postMessage({
            command: 'showMeta',
            tiddler
        });
    }

    return {
        init,
        createView,
        showMeta
    };
}

module.exports = {
    MetaWebView
};
