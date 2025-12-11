
> [!CAUTION]
> This VS Code extension will modify tidders in Tiddlywiki. Use it with caution,
> This extension is in the very early stages of development and may not be stable,
> Create a backup and test it before using.

# tiddlyedit

`tiddlyedit` is a Visual Studio Code extension that streamlines editing tiddlers in [TiddlyWiki](https://tiddlywiki.com/) configured with node.js. 


## Features

- **Search Tiddlers:** Search for tiddlers using a search bar. 
- **Syntax Highlighting:** Enhanced readability for TiddlyWiki markup using [TiddlyWiki5 Syntax](https://github.com/joshuafontany/VSCode-TW5-Syntax).
- **Edit Tiddlers:** Quickly edit and save tiddlers.
- **Auto Completion:** Auto complete using [Auto Complete](https://github.com/EvidentlyCube/TW5-AutoComplete) plugin for TiddlyWiki. Triggered by `Ctrl+Space`.
- **Meta Information:** View tiddler metadata.
- **Bidirectional Edit and View:** View a tiddler in the browser and send a tiddler from browser to edit it in VS Code.

## Requirements

* Require TiddlyWiki configured with node.js
* Requires [TiddlyWiki5 Syntax](https://github.com/joshuafontany/VSCode-TW5-Syntax)

## Usage

1. **Open sidebar panel** using the TiddlyWiki Icon in the left sidebar.
2. **Search Tiddlers** using the search bar at the top of the sidebar. You can enter a search term to filter tiddlers. If no search term is provided, it will show the results of default filter.
   - The default filter is `[all[tiddlers]!is[system]!is[shadow]!sort[modified]limit[10]]`, which can be configured in your VS Code settings.
   - You can also use a custom filter by entering it in the search bar. The filter is used if search term starts with `[`.
3. Open a tiddler to edit. The tiddler is saved into temporary folder with filename `title.tid` and content as tiddler text field.
4. Save your changes to update the tiddler in your TiddlyWiki instance through WebAPI.
5. Your browser will automatically refresh to show the updated tiddler. The sync interval is determined by the TiddlyWiki hidden configuration [Sync Polling Interval](https://tiddlywiki.com/#Hidden%20Setting%3A%20Sync%20Polling%20Interval).
6. Install [tw-livebridge](https://github.com/byzheng/tw-livebridge) to enable bidirectional editing, i.e. Open a tiddler in the browser from VS Code and edit a tiddler in VS Code from the browser.

## Extension Settings

`tiddlyedit` contributes the following settings:

- `tiddlywiki.host`: Base URL of the TiddlyWiki server (e.g., `http://127.0.0.1:8080`).
- `tiddlywiki.recipe`: Recipe name to use for TiddlyWiki (e.g., `default`).
- `tiddlywiki.defaultfilter`: Default filter for tiddlers (e.g., `[all[tiddlers]!is[system]!is[shadow]!sort[modified]limit[10]]`).
- `tiddlywiki.searchFilter`: Search filter for tiddlers (e.g., `[all[tiddlers]!is[system]search:title<query>limit[10]]`).
- `tiddlywiki.enableAutoSave`: Enable automatic saving of tiddler files (default: `false`).
- `tiddlywiki.autoSaveInterval`: Auto-save interval in seconds (default: `10`, range: 1-300).
- `tiddlywiki.sendCursorOffset`: Send cursor position offset to browser when previewing or saving tiddlers (default: `false`). When enabled, the browser can highlight the corresponding position in the tiddler being edited.

You can configure these in your VS Code settings.

## Configuration of TiddlyWiki

* Create a tiddler `$:/config/Server/AllowAllExternalFilters` with the text `yes` to configure the server to accept any filter. See [TiddlyWiki documentation](https://tiddlywiki.com/static/WebServer%2520API%253A%2520Get%2520All%2520Tiddlers.html) for more details.
* Reduce [Sync Polling Interval](https://tiddlywiki.com/#Hidden%20Setting%3A%20Sync%20Polling%20Interval) from server to client through creating a config tiddler `$:/config/SyncPollingInterval` (e.g., `1000` for 1 second). The default value is `60000` (60 seconds).
* [Auto Complete](https://github.com/EvidentlyCube/TW5-AutoComplete) plugin uses tag `$:/tags/EC/AutoComplete/Trigger` for triggers. Switched on the Hidden Setting `Sync System Tiddlers` by setting `$:/config/SyncSystemTiddlersFromServer` to `yes` to allow system tiddlers are returned by web API.


## Latest Release

**Version 0.2.8** - December 11, 2025
- Option to send cursor position offset to browser when opening and saving tiddlers (disabled by default), which allows the browser to highlight the cursor row when editing tiddlers in VS Code.

For complete release history, see [CHANGELOG.md](CHANGELOG.md).
