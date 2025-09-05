


const fetch = require('node-fetch');

/**
 * parseStringArray - Parses a TiddlyWiki-style string array into a JS array.
 * 
 * Adapted from: TiddlyWiki5 $tw.utils.parseStringArray
 * Source: https://github.com/TiddlyWiki/TiddlyWiki5
 * License: BSD 3-Clause (https://github.com/TiddlyWiki/TiddlyWiki5/blob/master/LICENSE)
 * 
 * Copyright (c) 2011–2024 Jeremy Ruston
 */
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

function TiddlywikiAPI(host, recipe = "default") {
    const this_host = host || "http://localhost:8080";
    // Perform a TiddlyWiki API request (supports GET and PUT)

    async function request(path, method = "GET", data = null) {
        if (typeof path !== "string" || path.trim() === "") {
            return Promise.reject(new Error("Invalid path: Path must be a non-empty string."));
        }

        const url = this_host + (path.startsWith("/") ? "" : "/") + path;

        // Validate URL
        try {
            new URL(url);
        } catch (e) {
            return Promise.reject(new Error("Invalid URL: " + url));
        }

        try {
            const options = {
                method,
                headers: {
                    "Content-Type": "application/json",
                    "x-requested-with": "TiddlyWiki"
                }
            };

            // Only include body for PUT/POST
            if (method === "PUT" || method === "POST") {
                options.body = JSON.stringify(data);
            }

            const response = await fetch(url, options);

            if (!response.ok) {
                throw new Error(`Failed to save: ${response.statusText}`);
            }

            if (response.status === 204) {
                return { success: true, data: null };
            }

            const result = await response.json();
            return { success: true, data: result };
        } catch (err) {
            console.error('Save error:', err);
            return { success: false, error: err };
        }
    }


    async function status() {
        const url = `${this_host}/status`;
        return request(url);
    }


    async function getTiddlerByTitle(title) {
        if (!title || typeof title !== "string" || title.trim() === "") {
            return Promise.reject(new Error("Invalid title: Title must be a non-empty string."));
        }
        const path = `/recipes/${recipe}/tiddlers/${encodeURIComponent(title)}`;
        try {
            return await request(path);
        } catch (e) {
            return null;
        }
    }

    async function getTiddlersByFilter(filter) {
        if (!filter || typeof filter !== "string" || filter.trim() === "") {
            return Promise.reject(new Error("Invalid filter: Filter must be a non-empty string."));
        }
        const path = `/recipes/${recipe}/tiddlers.json?filter=${encodeURIComponent(filter)}`;
        return request(path);
    }

    async function searchTiddlers(searchTerm) {
        if (!searchTerm || typeof searchTerm !== "string" || searchTerm.trim() === "") {
            return Promise.reject(new Error("Invalid search term: Search term must be a non-empty string."));
        }
        let filter = searchTerm;
        if (!searchTerm.startsWith("[")) {
            filter = `[all[tiddlers]!is[system]search:title[${searchTerm}]limit[10]]`;
        }
        const path = `/recipes/${recipe}/tiddlers.json?filter=${encodeURIComponent(filter)}`;
        return request(path);
    }

    async function getLatestTiddlers(number = 10) {
        if (!number || typeof number !== "number" || number <= 0) {
            return Promise.reject(new Error("Invalid number: Number must be a positive integer."));
        }
        const filter = `[all[tiddlers]!is[system]!is[shadow]!sort[modified]limit[${number}]]`;
        const path = `/recipes/${recipe}/tiddlers.json?filter=${encodeURIComponent(filter)}`;
        return request(path);
    }


    async function getAutoCompleteConfigure() {
        try {
            const filter = `[tag[$:/tags/EC/AutoComplete/Trigger]]`;
            const latest = await getTiddlersByFilter(filter);
            if (latest && latest.success) {
                return latest.data;
            } else {
                console.error('Could not fetch latest tiddlers for autocomplete');
                return [];
            }
        } catch (error) {
            console.error('Error fetching autocomplete suggestions:', error);
            return [];
        }
    }


    async function getAutoCompleteOptions(config, searchTerm) {

        if (typeof searchTerm !== "string") {
            return [];
        }
        if (!config ) {
            return [];
        }
        if (!config.filter) {
            return [];
        }
        if (searchTerm.startsWith(config.trigger)) {
            searchTerm = searchTerm.substring(config.trigger.length);
        }
        const filter = config.filter;
        const filterWithQuery = filter.replace(/<query>/g, "[" + searchTerm + "]");
        const items = await getTiddlersByFilter(filterWithQuery);
        if (!items || !items.success || !Array.isArray(items.data)) {
            return [];
        }
        return items;
    }

    async function getTiddlerFields(tiddler) {
        if (!tiddler || typeof tiddler !== "object") {
            return {};
        }
        const fields = {};
        for (const [key, value] of Object.entries(tiddler.fields || {})) {
            fields[key] = value;
        }
        return fields;
    }

    async function putTiddler(title, tags = [], fields = {}) {
        const path = `/recipes/default/tiddlers/${encodeURIComponent(title)}`;

        // Check if the tiddler exists
        const existingResult = await request(path);

        // Use TiddlyWiki's built-in tag parser
        const normalizeTags = (input) => parseStringArray(input || []);

        if (existingResult && existingResult.success) {
            const existingTiddler = existingResult.data;
            const existingTags = normalizeTags(existingTiddler.tags);
            const mergedTags = [...new Set([...existingTags, ...tags])];
            const existingFields = existingTiddler.fields || {};
            const mergedFields = { ...existingFields, ...fields };
            const updatedTiddler = {
                ...existingTiddler,
                fields: mergedFields,
                tags: mergedTags // ensure tags is always the mergedTags array
            };

            const result = await request(path, "PUT", updatedTiddler);
            return result;
        } else {
            const newTiddler = {
                title,
                tags: Array.isArray(tags) ? tags : normalizeTags(tags),
                ...fields
            };

            const result = await request(path, "PUT", newTiddler);
            return result;
        }
    }


    return {
        request: request,
        status: status,
        getTiddlerByTitle: getTiddlerByTitle,
        getTiddlersByFilter: getTiddlersByFilter,
        putTiddler: putTiddler,
        searchTiddlers: searchTiddlers,
        getLatestTiddlers: getLatestTiddlers,
        getAutoCompleteConfigure: getAutoCompleteConfigure,
        getAutoCompleteOptions: getAutoCompleteOptions,
        getHost: () => this_host
    };
}

module.exports = { TiddlywikiAPI, parseStringArray };

