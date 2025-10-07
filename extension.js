const vscode = require('vscode');
const { TiddlywikiAPI } = require('./src/tiddlywiki-api.js');
const { TiddlywikiEditor } = require('./src/tiddlywiki-editor.js');
const { AutoComplete } = require('./src/autocomplete.js');
const { TiddlersWebView } = require('./src/tiddlers-webview.js');
const { MetaWebView } = require('./src/meta-webview.js');
const { WSManager } = require('./src/ws-manager.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize TiddlyWiki API
let tiddlywikiAPI = null;
let tiddlywikiEditor = TiddlywikiEditor();
let tiddlersWebview = TiddlersWebView();
let metaWebView = MetaWebView();
let wsManager = WSManager();
let autoComplete = AutoComplete();

function getTiddlyWikiHost() {
    // Use environment variable in debug mode, otherwise use user config
    if (process.env.TIDDLYWIKI_HOST_TEST) {
        return process.env.TIDDLYWIKI_HOST_TEST;
    }
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    return config.get('host', 'http://127.0.0.1:8080');
}


function getSearchFilter() {
    // Use environment variable in debug mode, otherwise use user config
    if (process.env.TIDDLYWIKI_SEARCH_TEST) {
        return process.env.TIDDLYWIKI_SEARCH_TEST;
    }
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    return config.get('searchFilter', '[all[tiddlers]!is[system]search:title<query>limit[10]]');
}

function initializeAPI() {
    const config = vscode.workspace.getConfiguration('tiddlywiki');
    const host = getTiddlyWikiHost();
    const recipe = config.get('recipe', 'default');
    const searchFilter = getSearchFilter();

    tiddlywikiAPI = TiddlywikiAPI(host, recipe, searchFilter);
    return tiddlywikiAPI;
}

function activate(context) {

    // Initialize the API
    initializeAPI();
    tiddlywikiEditor.initEditor({
        TiddlersWebView: TiddlersWebView,
        metaWebview: metaWebView,
        tiddlywikiAPI: tiddlywikiAPI
    });

    wsManager.init({
        tiddlywikiEditor: tiddlywikiEditor,
        tiddlywikiAPI: tiddlywikiAPI
    })
    wsManager.connect();
    const tempFolder = tiddlywikiEditor.getTempFolder();
    const filePattern = `**/${tempFolder}/*.tid`;
    // Initialize autocomplete configuration
    (async () => {
        try {
            await autoComplete.loadConfigure(tiddlywikiAPI);
        } catch (error) {
            console.error('Failed to load autocomplete configuration:', error);
        }
    })();

    // Setup auto-save functionality
    tiddlywikiEditor.setupAutoSave();


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
            await tiddlywikiEditor.previewRmd(wsManager);
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
                    tiddlersWebview.loadTiddlersIntoWebview(tiddlywikiAPI);
                }
                
                // Restart auto-save with new settings
                tiddlywikiEditor.setupAutoSave();
                
                vscode.window.showInformationMessage('TiddlyWiki configuration updated!');
            }
        })
    );

    // Tiddlers list webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('tiddlywiki-tiddlers', {
            resolveWebviewView(webviewView) {

                tiddlersWebview.init({
                    webview: webviewView.webview,
                    extensionUri: context.extensionUri,
                    tiddlywikiAPI: tiddlywikiAPI,
                    tiddlywikiEditor: tiddlywikiEditor,
                    metaWebView: metaWebView
                })

                tiddlersWebview.createView();

            }
        })
    );

    // Meta webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('tiddlywiki-meta', {
            resolveWebviewView(webviewView) {
                metaWebView.init({
                    webview: webviewView.webview,
                    extensionUri: context.extensionUri,
                    tiddlywikiAPI: tiddlywikiAPI,
                    tiddlywikiEditor: tiddlywikiEditor,
                    tiddlersWebview: tiddlersWebview,
                    wsManager: wsManager
                })

                metaWebView.createView();
            }
        })
    );
    // Auto complete 
    context.subscriptions.push(
        vscode.commands.registerCommand('tiddlyedit.insertAutocomplete', async () => {
            autoComplete.showQuickPick();
        })
    );
    // Save tiddler on document save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            await tiddlywikiEditor.saveTiddler(document);
        })
    );

    // Create link for [[Tiddler Title]] in .tid files
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(
            { pattern: "**/*.{Tid,tid,R,r,Rmd,rmd}" },
            {
                provideDocumentLinks(doc) {
                    const regex = /\[\[(.*?)\]\]/g;
                    const links = [];
                    const text = doc.getText();

                    // Helper to extract tiddler name from TiddlyWiki link ([[tiddler]] or [[title|tiddler]])
                    function extractTiddlerFromLink(linkText) {
                        // Match [[tiddler]] or [[title|tiddler]]
                        const match = linkText.match(/^\[\[(?:[^\]|]*\|)?([^\]]+)\]\]$/);
                        return match ? match[1] : null;
                    }
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const linkText = match[0];
                        const tiddler = extractTiddlerFromLink(linkText);
                        if (!tiddler) continue;
                        const start = doc.positionAt(match.index);
                        const end = doc.positionAt(match.index + match[0].length);
                        const range = new vscode.Range(start, end);
                        const uri = vscode.Uri.parse(
                            `command:tiddly.openTiddler?${encodeURIComponent(JSON.stringify([tiddler]))}`
                        );
                        const link = new vscode.DocumentLink(range, uri);
                        link.tooltip = `Open tiddler: ${tiddler}`;
                        links.push(link);
                    }

                    return links;
                }
            }
        )
    );
    // context.subscriptions.push(

    //     vscode.languages.registerCompletionItemProvider(
    //         { pattern: "**/*.tid" },
    //         {
    //             async provideCompletionItems(document, position) {
    //                 const line = document.lineAt(position).text;
    //                 const prefix = line.substring(0, position.character);

    //                 // Step 1: detect /tw mode
    //                 const match = prefix.match(/\/tw([^\n]*)$/);
    //                 //const match = line.text.substring(0, position.character).match(/\/tw\s+([^\n]*)$/);

    //                 if (!match) {
    //                     return; // not in /tw context
    //                 }
    //                 const afterTw = match[1];
    //                 const autoOptions = await autoComplete.getAutoCompleteOptions(afterTw);

    //                 if (autoOptions?.options && Array.isArray(autoOptions.options)) {
    //                     const items = await Promise.all(
    //                         autoOptions.options.map(async opt => {
    //                             const item = new vscode.CompletionItem(
    //                                 opt.title,
    //                                 vscode.CompletionItemKind.Text
    //                             );
    //                             const snippet = await autoComplete.getSnippet(
    //                                 autoOptions.trigger,
    //                                 opt.title
    //                             );

    //                             console.log("Generated snippet:", snippet);
    //                             item.insertText = snippet;
    //                             console.log("item:", item);
    //                             return item;
    //                         })
    //                     );
    //                     return items;
    //                 }
    //             }
    //         },
    //         "/" // trigger character
    //     )
    // );

    // Register command to handle the click
    context.subscriptions.push(
        vscode.commands.registerCommand('tiddly.openTiddler', (tiddlerTitle) => {
            console.log("Opening tiddler:", tiddlerTitle);
            wsManager.sendOpenTiddlerToWebSocket({ title: tiddlerTitle });
        })
    );
}


function deactivate() {
    // Stop auto-save timer
    tiddlywikiEditor.stopAutoSave();
    //tiddlywikiEditor.clearTempFiles(); // Clear temp files on deactivate
    //wsManager.close(); // Close WebSocket connection on deactivate
}

module.exports = {
    activate,
    deactivate
};
