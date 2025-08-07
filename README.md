
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

## Requirements

* Require TiddlyWiki configured with node.js
* Requires [TiddlyWiki5 Syntax](https://github.com/joshuafontany/VSCode-TW5-Syntax)

## Usage

1. **Open sidebar panel** using the TiddlyWiki Icon in the left sidebar.
2. The latest 10 tiddlers are listed or you can use the search bar to find a specific tiddler.
3. Open a tiddler to edit. The tiddler is saved into temporary folder with filename `title.tid` and content as tiddler text field.
4. Save your changes to update the tiddler in your TiddlyWiki instance through WebAPI.
5. Your browser will automatically refresh to show the updated tiddler. The sync interval is determined by the TiddlyWiki hidden configuration [Sync Polling Interval](https://tiddlywiki.com/#Hidden%20Setting%3A%20Sync%20Polling%20Interval).

## Extension Settings

`tiddlyedit` contributes the following settings:

- `tiddlyedit.host`: Base URL of the TiddlyWiki server (e.g., `http://127.0.0.1:8080`).
- `tiddlyedit.recipe`: Recipe name to use for TiddlyWiki (e.g., `default`).

You can configure these in your VS Code settings.

## Configuration of TiddlyWiki

* Reduce [Sync Polling Interval](https://tiddlywiki.com/#Hidden%20Setting%3A%20Sync%20Polling%20Interval) from server to client through creating a config tiddler `$:/config/SyncPollingInterval` (e.g., `1000` for 1 second). The default value is `60000` (60 seconds).

## Release Notes


### 0.0.2

- Auto completion using [Auto Complete](https://github.com/EvidentlyCube/TW5-AutoComplete) plugin for TiddlyWiki.

### 0.0.1

- Added preview support for Tiddlers.
- Improved syntax highlighting for macros and widgets.
