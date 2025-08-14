// Tiddlers webview script
const vscode = acquireVsCodeApi();

// TiddlyWiki string array parser (copied from tiddlywiki-api.js)
function parseStringArray(value, allowDuplicate = false) {
    if (typeof value === "string") {
        const memberRegExp = /(?:^|[^\S\xA0])(?:\[\[(.*?)\]\])(?=[^\S\xA0]|$)|([\S\xA0]+)/mg;
        const results = [];
        const names = {};
        let match;
        do {
            match = memberRegExp.exec(value);
            if (match) {
                const item = match[1] || match[2];
                if (item !== undefined && (!names.hasOwnProperty(item) || allowDuplicate)) {
                    results.push(item);
                    names[item] = true;
                }
            }
        } while (match);
        return results;
    } else if (Array.isArray(value)) {
        return value;
    } else {
        return null;
    }
}



document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('tw-search');
    const refreshButton = document.getElementById('tw-refresh');
    const tiddlerList = document.getElementById('tw-tiddler-list');

    // Search functionality with debouncing
    let searchTimeout;
    searchInput.addEventListener('input', function() {
        if (searchInput.value.length < 2) {
            tiddlerList.innerHTML = '';
            return;
        }
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
                if (typeof message.searchTerm === 'string' && message.searchTerm.trim() !== '') {
                    searchInput.value = message.searchTerm;
                }
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
                const tags = parseStringArray(tiddler.tags);
                tagsDiv.textContent = tags.join(', ');
            }
            
            li.appendChild(titleDiv);
            if (tagsDiv.textContent) {
                li.appendChild(tagsDiv);
            }
            
            // Click handlers
            li.addEventListener('click', function() {
                // Highlight selected item
                document.querySelectorAll('.tiddler-item').forEach(item => {
                    item.classList.remove('selected');
                });
                li.classList.add('selected');
                
                // Select this tiddler and notify meta panel
                vscode.postMessage({
                    command: 'selectTiddler',
                    tiddler: tiddler
                });
                
                // Open tiddler for editing
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
