const vscode = acquireVsCodeApi();

document.getElementById('tw-search').addEventListener('input', e => {
    vscode.postMessage({ command: 'search', text: e.target.value });
});

document.getElementById('tw-refresh').addEventListener('click', () => {
    const searchValue = document.getElementById('tw-search').value;
    vscode.postMessage({ command: 'search', text: searchValue });
});

window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'updateList') {
        const ul = document.getElementById('tw-tiddler-list');
        ul.innerHTML = '';
        for (const item of message.items) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#';
            a.textContent = item.title;
            a.onclick = (e) => {
                e.preventDefault();
                vscode.postMessage({ command: 'openTiddler', item: item });
            };
            li.appendChild(a);
            li.onclick = () => {
                vscode.postMessage({ command: 'openTiddler', item: item });
            };
            ul.appendChild(li);
        }
    }
});