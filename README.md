
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

## Extension Settings

`tiddlyedit` contributes the following settings:

- `tiddlyedit.host`: Base URL of the TiddlyWiki server (e.g., `http://127.0.0.1:8080`).
- `tiddlyedit.recipe`: Recipe name to use for TiddlyWiki (e.g., `default`).

You can configure these in your VS Code settings.


## Release Notes


### 0.0.2

- Auto completion using [Auto Complete](https://github.com/EvidentlyCube/TW5-AutoComplete) plugin for TiddlyWiki.

### 0.0.1

- Added preview support for Tiddlers.
- Improved syntax highlighting for macros and widgets.
