// Operation of a single tiddler, e.g. open, save, delete temp file
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

function TiddlywikiEditor() {
    let _metaWebView = null;
    let _tiddlersWebView = null;
    let _tiddlywikiAPI = null;
    let _wsManager = null;
    const _tempFiles = new Set();
    const _tempFolder = path.join(os.tmpdir(), 'tiddlyedit-temp');
    let _autoSaveTimer = null;
    
    // Create it once if it doesn't exist
    if (!fs.existsSync(_tempFolder)) {
        fs.mkdirSync(_tempFolder);
    }
    
    // Create it once if it doesn’t exist
    if (!fs.existsSync(_tempFolder)) {
        fs.mkdirSync(_tempFolder);
    }

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
            let realTempDir = fs.realpathSync(_tempFolder);
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
    
    // Send tiddler update to browser with optional cursor offset
    function sendTiddlerToWebSocket(title, editor) {
        if (!_wsManager) return;
        
        const config = vscode.workspace.getConfiguration('tiddlywiki');
        const sendCursorOffset = config.get('sendCursorOffset', false);
        
        const payload = { title };
        
        if (sendCursorOffset && editor) {
            const position = editor.selection.active;
            const offset = editor.document.offsetAt(position);
            payload.offset = offset;
        }
        
        _wsManager.sendOpenTiddlerToWebSocket(payload);
    }
    function initEditor({TiddlersWebView, metaWebview, tiddlywikiAPI})  {
        _metaWebView = metaWebview;
        _tiddlersWebView = TiddlersWebView;
        _tiddlywikiAPI = tiddlywikiAPI
    }

    function setWsManagrer(wsManager) {
        _wsManager = wsManager;
    }

    async function editTiddler(tiddler) {
        try {
            const result = await _tiddlywikiAPI.getTiddlerByTitle(tiddler.title);
            if (!result || !result.success) {
                vscode.window.showErrorMessage(`Could not fetch tiddler: ${tiddler.title}`);
                return;
            }

            const tiddlerData = result.data;
            if(tiddlerData.title.startsWith('$:/')) {
                tiddlerData.title = tiddlerData.title.replaceAll('/', '⁄')
                tiddlerData.title = tiddlerData.title.replaceAll('$', '＄');
                tiddlerData.title = tiddlerData.title.replaceAll(':', '꞉');
                tiddlerData.title = tiddlerData.title.replaceAll('?', '？');
                tiddlerData.title = tiddlerData.title.replaceAll('*', '＊');
                tiddlerData.title = tiddlerData.title.replaceAll('"', '＂');
                tiddlerData.title = tiddlerData.title.replaceAll('<', '＜');
                tiddlerData.title = tiddlerData.title.replaceAll('>', '＞');
                tiddlerData.title = tiddlerData.title.replaceAll('|', '｜');
                tiddlerData.title = tiddlerData.title.replaceAll('\\', '＼');
                tiddlerData.title = tiddlerData.title.replaceAll('/', '⁄');
            }
            const tmpFilePath = path.join(_tempFolder, `${tiddlerData.title}.tid`);
            // Normalize line endings to \n to match TiddlyWiki format
            const normalizedText = (tiddlerData.text || '').replace(/\r\n/g, '\n');
            fs.writeFileSync(tmpFilePath, normalizedText, 'utf8');

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
            _tempFiles.add(tmpFilePath);
            
            if (_metaWebView) {
                _metaWebView.showMeta(tiddlerData); // show meta data
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Error opening tiddler: ${error.message}`);
        }
    }

    async function modifyTiddler(data) {
        if (!data || typeof data !== 'object') {
            console.log('Invalid data format for modifyTiddler');
            return;
        }
        // Check if op is 'insert'
        if (data.op !== 'insert') {
            console.log('Unsupported operation:', data.op);
            vscode.window.setStatusBarMessage(`Unsupported operation: ${data.op}`, 3000);
            return;
        }

        // Check if content is provided
        if (!data.content) {
            console.log('No content provided for insert operation');
            return;
        }

        // Get the currently active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.setStatusBarMessage('No active editor found', 3000);
            return;
        }

        // Check if the active editor is a valid tiddler file in temp directory
        const document = editor.document;
        if (!isInTempDir(document.fileName)) {
            vscode.window.setStatusBarMessage('Active editor is not a tiddler file. Please open a tiddler first.', 3000);
            return;
        }

        // Check if it's a .tid file
        if (!document.fileName.endsWith('.tid')) {
            vscode.window.setStatusBarMessage('Active editor is not a .tid file.', 3000);
            return;
        }

        try {
            // Get current cursor position
            const position = editor.selection.active;
            
            // Insert content at cursor position
            await editor.edit(editBuilder => {
                editBuilder.insert(position, data.content);
            });

        } catch (error) {
            console.error('Error inserting content:', error);
            vscode.window.setStatusBarMessage(`Error inserting content: ${error.message}`, 3000);
        }
    }

    async function saveTiddler(document) {
        if (!document || !document.fileName) return; // ignore invalid
        if (!isInTempDir(document.fileName)) return; //ignore if not in temp dir
        if (!document.fileName.endsWith('.tid')) return; // ignore if not .tid file

        if (!_tiddlywikiAPI) return; // ignore if no API

        let title = path.basename(document.fileName, '.tid');
        if(title.startsWith('＄꞉⁄')) {
            title = title.replaceAll('⁄', '/')
            title = title.replaceAll('＄', '$');
            title = title.replaceAll('꞉', ':');
            title = title.replaceAll('？', '?');
            title = title.replaceAll('＊', '*');
            title = title.replaceAll('＂', '"');
            title = title.replaceAll('＜', '<');
            title = title.replaceAll('＞', '>');
            title = title.replaceAll('｜', '|');
            title = title.replaceAll('＼', '\\');
            title = title.replaceAll('⁄', '/');
        }
        const newText = document.getText();

        try {
            // Get existing tiddler to preserve other fields
            const existingResult = await _tiddlywikiAPI.getTiddlerByTitle(title);

            if (!existingResult || !existingResult.success) {
                vscode.window.showWarningMessage('Cannot find the original tiddler to save changes.');
                return;
            }

            // Create updated tiddler with new text

            const updatedFields = {
                text: newText,
                modified: getTiddlyWikiModifiedDate()
            };

            // Save back to TiddlyWiki using PUT request
            const saveResult = await _tiddlywikiAPI.putTiddler(title, [], updatedFields);

            if (saveResult && saveResult.success) {
                vscode.window.setStatusBarMessage(`✅ Tiddler "${title}" saved`, 3000); // shows for 3 seconds
                
                // Send update to browser with cursor offset if enabled
                const editor = vscode.window.visibleTextEditors.find(ed => ed.document === document);
                sendTiddlerToWebSocket(title, editor);
            } else {
                throw new Error(saveResult?.error?.message || 'Unknown save error');
            }

        } catch (err) {
            console.error('Save error:', err);
            vscode.window.showErrorMessage(`❌ Could not save "${title}": ${err.message}`);
        }
    }
    function clearTempFiles() {
        // Close all tabs for temp files
        // const tabsToClose = [];
        // for (const tabGroup of vscode.window.tabGroups.all) {
        //     for (const tab of tabGroup.tabs) {
        //         if (tab.input instanceof vscode.TabInputText) {
        //             const tabPath = tab.input.uri.fsPath;
        //             // Check if tab is in temp directory
        //             if (isInTempDir(tabPath) && tabPath.endsWith('.tid')) {
        //                 tabsToClose.push(tab);
        //             }
        //         }
        //     }
        // }
        
        // // Close all tabs at once
        // if (tabsToClose.length > 0) {
        //     vscode.window.tabGroups.close(tabsToClose);
        // }
        
        // Cleanup all remaining temp files
        for (const filePath of _tempFiles) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.error("Failed to delete temp file on deactivate:", err);
            }
        }
        _tempFiles.clear();
    }
    // preview Rmd file in TiddlyWiki
    async function previewRmd(wsManager) {
        if (!wsManager) {
            vscode.window.showWarningMessage('WebSocket manager is not initialized.');
            return;
        }
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
            return;
        }
        
        // Send tiddler to browser with cursor offset if enabled
        sendTiddlerToWebSocket(tiddlerTitle, editor);
    }

    // Auto-save functionality
    function setupAutoSave() {
        const config = vscode.workspace.getConfiguration('tiddlywiki');
        const enableAutoSave = config.get('enableAutoSave', true);
        const autoSaveInterval = config.get('autoSaveInterval', 10);
        // Clear existing timer
        if (_autoSaveTimer) {
            clearInterval(_autoSaveTimer);
            _autoSaveTimer = null;
        }

        if (!enableAutoSave) {
            console.log('Auto-save is disabled');
            return;
        }

        console.log(`Setting up auto-save with ${autoSaveInterval} second interval`);
        
        _autoSaveTimer = setInterval(async () => {
            await performAutoSave();
        }, autoSaveInterval * 1000);
    }

    async function performAutoSave() {
        // Get all open text editors
        const editors = vscode.window.visibleTextEditors;
        
        for (const editor of editors) {
            const document = editor.document;
            
            // Check if it's a tiddler file that needs saving
            if (document.isDirty && 
                document.fileName.endsWith('.tid') && 
                isInTempDir(document.fileName)) {
                
                try {
                    // Save the document
                    await document.save();
                    await saveTiddler(document);
                    console.log(`Auto-saved: ${document.fileName}`);
                } catch (error) {
                    console.error(`Auto-save failed for ${document.fileName}:`, error);
                }
            }
        }
    }

    function stopAutoSave() {
        if (_autoSaveTimer) {
            clearInterval(_autoSaveTimer);
            _autoSaveTimer = null;
        }
    }

    return {
        initEditor,
        hasRemoteTiddleDocument,
        isInTempDir,
        editTiddler,
        modifyTiddler,
        saveTiddler,
        clearTempFiles,
        previewRmd,
        setupAutoSave,
        stopAutoSave,
        setWsManagrer,
        getTempFolder() { return _tempFolder; }
    };
}


module.exports = {
    TiddlywikiEditor
};
