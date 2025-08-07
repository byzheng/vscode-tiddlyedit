const vscode = require('vscode');
const fetch = require('node-fetch');

let currentTiddlerTitle = null;
let currentDocument = null;

function activate(context) {
	let disposable = vscode.commands.registerCommand('tiddlywiki-sync.openTiddler', async () => {
		try {
			const res = await fetch('http://127.0.0.1:8080/recipes/default/tiddlers.json');
			if (!res.ok) throw new Error(`Failed to get tiddlers: ${res.statusText}`);
			const tiddlers = await res.json();

			const titles = tiddlers.map(t => t.title).sort();

			const selected = await vscode.window.showQuickPick(titles, { placeHolder: 'Select a tiddler to edit' });
			if (!selected) return;

			const tiddlerRes = await fetch(`http://127.0.0.1:8080/recipes/default/tiddlers/${encodeURIComponent(selected)}`);
			if (!tiddlerRes.ok) throw new Error(`Failed to get tiddler: ${tiddlerRes.statusText}`);
			const content = await tiddlerRes.text();

			currentTiddlerTitle = selected;
			currentDocument = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
			await vscode.window.showTextDocument(currentDocument);

		} catch (err) {
			vscode.window.showErrorMessage(err.message);
		}
	});

	context.subscriptions.push(disposable);

	vscode.workspace.onDidSaveTextDocument(async (document) => {
		if (document === currentDocument && currentTiddlerTitle) {
			try {
				const updatedContent = document.getText();

				const putRes = await fetch(`http://127.0.0.1:8080/recipes/default/tiddlers/${encodeURIComponent(currentTiddlerTitle)}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'text/plain' },
					body: updatedContent
				});

				if (!putRes.ok) {
					vscode.window.showErrorMessage(`Failed to update tiddler: ${putRes.statusText}`);
				} else {
					vscode.window.showInformationMessage(`Tiddler "${currentTiddlerTitle}" saved successfully.`);
				}

			} catch (err) {
				vscode.window.showErrorMessage(`Error saving tiddler: ${err.message}`);
			}
		}
	});
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};
