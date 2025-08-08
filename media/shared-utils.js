// Shared utility functions for webviews
// This file contains common functions used across multiple webview scripts

// TiddlyWiki string array parser
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

// Add other shared utility functions here as needed
function formatTiddlyWikiDate(dateString) {
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
