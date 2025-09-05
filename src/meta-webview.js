const vscode = require('vscode');


function MetaWebView() {
    let webviewInstance = null;
    let tiddlersWebviewRef = null;
    function initView(webview, extensionUri, tiddlywikiAPI, tiddlersRef) {
        webviewInstance = webview;
        tiddlersWebviewRef = tiddlersRef;
        webview.options = { enableScripts: true };
        webview.html = getMetaWebviewContent(webview, extensionUri);
        webview.postMessage({ command: 'clearMeta' });

        webview.onDidReceiveMessage(async message => {
            if (message.command === 'openTiddlerInTiddlywiki') {
                if (tiddlersWebviewRef && tiddlersWebviewRef.sendOpenTiddlerToWebSocket) {
                    tiddlersWebviewRef.sendOpenTiddlerToWebSocket(message.tiddler);
                }
            } else if (message.command === 'updateTiddlerTags') {
                const { title, tags } = message;
                try {
                    const result = await tiddlywikiAPI.getTiddlerByTitle(title);
                    if (result && result.success) {
                        const tiddler = result.data;
                        tiddler.tags = tags;
                        const saveResult = await tiddlywikiAPI.putTiddler(title, [], tiddler);
                        if (saveResult && saveResult.success) {
                            vscode.window.setStatusBarMessage(`Tags updated for '${title}'`, 2000);
                            // Optionally refresh tiddler list
                            if (tiddlersWebviewRef && tiddlersWebviewRef.loadTiddlersIntoWebview) {
                                tiddlersWebviewRef.loadTiddlersIntoWebview(tiddlywikiAPI);
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
        if (webviewInstance) {
            webviewInstance.postMessage({
                command: 'showMeta',
                tiddler
            });
        }
    }

    return {
        initView,
        showMeta
    };
}

module.exports = {
    MetaWebView
};
