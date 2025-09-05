// Operation of a single tiddler, e.g. open, save, delete temp file
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

function TiddlywikiEditor() {
    let _metaWebView = null;
    let _tiddlersWebView = null;
    let _tiddlywikiAPI = null;
    const _tempFiles = new Set();
    const _tempFolder = path.join(os.tmpdir(), 'tiddlyedit-temp');
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
    function initEditor({TiddlersWebView, metaWebview, tiddlywikiAPI})  {
        _metaWebView = metaWebview;
        _tiddlersWebView = TiddlersWebView;
        _tiddlywikiAPI = tiddlywikiAPI;
    }
    async function editTiddler(tiddler) {
        try {
            const result = await _tiddlywikiAPI.getTiddlerByTitle(tiddler.title);
            if (!result || !result.success) {
                vscode.window.showErrorMessage(`Could not fetch tiddler: ${tiddler.title}`);
                return;
            }

            const tiddlerData = result.data;
            const tmpFilePath = path.join(_tempFolder, `${tiddlerData.title}.tid`);
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
            _tempFiles.add(tmpFilePath);
            
            if (_metaWebView) {
                _metaWebView.showMeta(tiddler); // show meta data
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Error opening tiddler: ${error.message}`);
        }
    }
    async function saveTiddler(document) {
        if (!document || !document.fileName) return; // ignore invalid
        if (!isInTempDir(document.fileName)) return; //ignore if not in temp dir
        if (!document.fileName.endsWith('.tid')) return; // ignore if not .tid file

        if (!_tiddlywikiAPI) return; // ignore if no API

        const title = path.basename(document.fileName, '.tid');
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
            } else {
                throw new Error(saveResult?.error?.message || 'Unknown save error');
            }

        } catch (err) {
            console.error('Save error:', err);
            vscode.window.showErrorMessage(`❌ Could not save "${title}": ${err.message}`);
        }
    }
    function clearTempFiles() {
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
    async function previewRmd(ws) {
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
        if (ws && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                type: "open-tiddler",
                title: tiddlerTitle
            }));
            vscode.window.setStatusBarMessage(`Previewing '${tiddlerTitle}' in TiddlyWiki.`, 3000);
        } else {
            vscode.window.setStatusBarMessage('WebSocket is not connected.', 3000);
        }
    }
    return {
        initEditor,
        hasRemoteTiddleDocument,
        isInTempDir,
        editTiddler,
        saveTiddler,
        clearTempFiles,
        previewRmd,
        getTempFolder() { return _tempFolder; }
    };
}


module.exports = {
    TiddlywikiEditor
};
