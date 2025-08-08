// Tiddlers webview script
const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('tw-search');
    const refreshButton = document.getElementById('tw-refresh');
    const tiddlerList = document.getElementById('tw-tiddler-list');

    // Search functionality with debouncing
    let searchTimeout;
    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const searchText = searchInput.value;
            vscode.postMessage({
                command: 'search',
                text: searchText
            });
        }, 300); // 300ms debounce
    });

    // Refresh functionality
    refreshButton.addEventListener('click', function() {
        vscode.postMessage({
            command: 'refresh'
        });
    });

    // Listen for messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.command) {
            case 'updateList':
                updateTiddlerList(message.items);
                break;
        }
    });

    function updateTiddlerList(tiddlers) {
        tiddlerList.innerHTML = '';
        
        if (!tiddlers || tiddlers.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No tiddlers found';
            li.className = 'no-results';
            tiddlerList.appendChild(li);
            return;
        }

        tiddlers.forEach(tiddler => {
            const li = document.createElement('li');
            li.className = 'tiddler-item';
            
            const titleDiv = document.createElement('div');
            titleDiv.className = 'tiddler-title';
            titleDiv.textContent = tiddler.title || 'Untitled';
            
            const tagsDiv = document.createElement('div');
            tagsDiv.className = 'tiddler-tags';
            if (tiddler.tags) {
                const tags = Array.isArray(tiddler.tags) ? tiddler.tags : [tiddler.tags];
                tagsDiv.textContent = tags.join(', ');
            }
            
            li.appendChild(titleDiv);
            if (tagsDiv.textContent) {
                li.appendChild(tagsDiv);
            }
            
            // Click handlers
            li.addEventListener('click', function() {
                // Select this tiddler and notify meta panel
                vscode.postMessage({
                    command: 'selectTiddler',
                    tiddler: tiddler
                });
                
                // Highlight selected item
                document.querySelectorAll('.tiddler-item').forEach(item => {
                    item.classList.remove('selected');
                });
                li.classList.add('selected');
            });
            
            // Double-click to open for editing
            li.addEventListener('dblclick', function() {
                vscode.postMessage({
                    command: 'openTiddler',
                    tiddler: tiddler
                });
            });
            
            tiddlerList.appendChild(li);
        });
    }

    // Load initial tiddlers
    vscode.postMessage({
        command: 'refresh'
    });
});
