// ws-manager.js
const WebSocket = require('ws');

function WSManager() {
    let _tiddlywikiEditor, _tiddlywikiAPI;
    let _host = null;
    let ws = null;
    let reconnectAttempts = 0;
    const maxReconnectDelay = 30000;
    const MAX_RECONNECT_ATTEMPTS = 10;
    function init({tiddlywikiEditor, tiddlywikiAPI}) {
        _tiddlywikiEditor = tiddlywikiEditor;
        _tiddlywikiAPI = tiddlywikiAPI;
        let cleanHost = _tiddlywikiAPI.getHost().replace(/^https?:\/\//, '');
        _host = `ws://${cleanHost}/ws`;
    }
    function connect() {
        reconnectAttempts = 0;
        _connect();
    }

    function _connect() {
        ws = new WebSocket(_host);

        ws.onopen = () => {
            reconnectAttempts = 0;
            console.log('WebSocket connection established');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received WebSocket message:', data);
                if (data.type === 'edit-tiddler' && data.title) {
                    _tiddlywikiEditor.editTiddler(data);
                }
            } catch (e) {
                console.error('Error parsing WebSocket message:', e);
            }
        };

        ws.onclose = (event) => {
            console.log(`WebSocket closed (code: ${event.code}, reason: ${event.reason})`);
            if (event.code !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay);
                console.warn(`WebSocket disconnected. Reconnecting in ${delay / 1000}s...`);
                setTimeout(() => _connect(), delay);
            } else {
                console.log('WebSocket closed normally, will not reconnect.');
            }
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    function sendOpenTiddlerToWebSocket(tiddler) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "open-tiddler",
                title: tiddler.title
            }));
        } else {
            console.warn('WebSocket is not connected.');
        }
    }

    function close() {
        if (ws) {
            ws.close(1000, 'Extension deactivated');
        }
    }

    function getWS() {
        return ws;
    }

    return {
        init,
        connect,
        sendOpenTiddlerToWebSocket,
        close,
        getWS
    };
}

module.exports = {
    WSManager
};
