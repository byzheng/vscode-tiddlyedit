
// Meta webview script
const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', function() {
    const noSelection = document.getElementById('no-selection');
    const metaContent = document.getElementById('meta-content');

    // Listen for messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.command) {
            case 'showMeta':
                showTiddlerMeta(message.tiddler);
                break;
            case 'clearMeta':
                clearMeta();
                break;
        }
    });

    function showTiddlerMeta(tiddler) {
        noSelection.style.display = 'none';
        metaContent.style.display = 'block';
        metaContent.innerHTML = '';
        const openTiddlerInTiddlyWiki = renderOpenInBrowserButton(tiddler);
        metaContent.appendChild(openTiddlerInTiddlyWiki);
        // Title
        const titleSection = createSection('Basic Information');
        titleSection.appendChild(createField('Title', tiddler.title || 'Untitled'));
        const fields = [
            { key: 'type', label: 'Type' },
            { key: 'created', label: 'Created', format: formatDate },
            { key: 'modified', label: 'Modified', format: formatDate },
            { key: 'creator', label: 'Creator' },
            { key: 'modifier', label: 'Modifier' }
        ];

        fields.forEach(field => {
            if (tiddler[field.key]) {
                const value = field.format ? field.format(tiddler[field.key]) : tiddler[field.key];
                titleSection.appendChild(createField(field.label, value));
            }
        });
        metaContent.appendChild(titleSection);

        // Tags
        if (tiddler.tags && tiddler.tags.length > 0) {
            const tagsSection = createSection('Tags');
            const tags = parseStringArray(tiddler.tags);
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'tags-container';
            
            tags.forEach(tag => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'tag';
                tagSpan.textContent = tag;
                tagsContainer.appendChild(tagSpan);
            });
            
            tagsSection.appendChild(tagsContainer);
            metaContent.appendChild(tagsSection);
        }
        // Custom Fields
        const customFields = getCustomFields(tiddler.fields);

        if (customFields.length > 0) {
            const customSection = createSection('Custom Fields');
            customFields.forEach(field => {
                customSection.appendChild(createField(field.key, field.value));
            });
            metaContent.appendChild(customSection);
        }

        // Text preview (first 200 characters)
        // if (tiddler.text) {
        //     const textSection = createSection('Text Preview');
        //     const textPreview = document.createElement('div');
        //     textPreview.className = 'text-preview';
        //     textPreview.textContent = tiddler.text.substring(0, 200) + 
        //         (tiddler.text.length > 200 ? '...' : '');
        //     textSection.appendChild(textPreview);
        //     metaContent.appendChild(textSection);
        // }
    }
    function renderOpenInBrowserButton(tiddler) {
        metaContent.innerHTML = '';
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.alignItems = 'center';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginBottom = '10px';

        const openBtn = document.createElement('button');
        openBtn.id = 'open-in-browser-btn';
        openBtn.title = 'Open in TiddlyWiki';
        openBtn.style.background = 'var(--vscode-button-background)';
        openBtn.style.color = 'var(--vscode-button-foreground)';
        openBtn.style.border = 'none';
        openBtn.style.padding = '6px 12px';
        openBtn.style.borderRadius = '3px';
        openBtn.style.cursor = 'pointer';
        openBtn.style.fontSize = '14px';
        openBtn.textContent = '🌐 Open in TiddlyWiki';

        buttonContainer.appendChild(openBtn);
        //metaContent.appendChild(buttonContainer);

        // Re-attach the event listener for the dynamically created button
        openBtn.addEventListener("click", () => {
            if (!tiddler.title) {
                alert("No tiddler selected");
                return;
            }
            alert("Opening tiddler in TiddlyWiki: " + tiddler.title);
            vscode.postMessage({
                command: "openTiddlerInTiddlywiki",
                tiddler: tiddler
            });
        });
        return buttonContainer;
    }
    function clearMeta() {
        noSelection.style.display = 'block';
        metaContent.style.display = 'none';
    }

    function createSection(title) {
        const section = document.createElement('div');
        section.className = 'meta-section';
        
        const sectionTitle = document.createElement('h3');
        sectionTitle.className = 'section-title';
        sectionTitle.textContent = title;
        section.appendChild(sectionTitle);
        
        return section;
    }

    function createField(label, value) {
        const field = document.createElement('div');
        field.className = 'meta-field';
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'field-label';
        labelSpan.textContent = label + ':';
        
        const valueSpan = document.createElement('span');
        valueSpan.className = 'field-value';
        valueSpan.textContent = value || '';
        
        field.appendChild(labelSpan);
        field.appendChild(valueSpan);
        
        return field;
    }

    function getCustomFields(tiddler) {
        const standardFields = ['title', 'text', 'tags', 'type', 'created', 'modified', 'creator', 'modifier'];
        const customFields = [];
        
        for (const [key, value] of Object.entries(tiddler)) {
            if (!standardFields.includes(key) && value !== undefined && value !== null) {
                customFields.push({ key: key, value: String(value) });
            }
        }
        console.log('Custom Fields:', customFields);
        return customFields;
    }

    function formatDate(dateString) {
        if (!dateString) return '';
        // TiddlyWiki format: YYYYMMDDHHMMSSXXX
        if (dateString.length === 17) {
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            const hour = dateString.substring(8, 10);
            const minute = dateString.substring(10, 12);
            const second = dateString.substring(12, 14);
            return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
        }
        return dateString;
    }
});
