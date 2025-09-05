
function AutoComplete() {
    let _autoCompleteConfigure = null;
    async function loadConfigure(tiddlywikiAPI) {
        try {
            _autoCompleteConfigure = await tiddlywikiAPI.getAutoCompleteConfigure();
        } catch (error) {
            console.error('Failed to load autocomplete configuration:', error);
        }
    }
    function getAutoTrigger(value) {
        if (!_autoCompleteConfigure || !Array.isArray(_autoCompleteConfigure)) {
            return null;
        }
        for (const conf of _autoCompleteConfigure) {
            if (!conf || typeof conf.trigger !== 'string' || conf.trigger === '') {
                continue;
            }
            if (!value.startsWith(conf.trigger)) {
                continue; // not matching this trigger
            }
            return conf;
        }
        return null
    }
    async function getAutoCompleteOptions(tiddlywikiAPI, value) {
        if (typeof value !== "string" || value.length < 2) {
            return [];
        }
        let options = [];
        const autoTrigger = getAutoTrigger(value);
        if (autoTrigger) {
            // If we have a trigger, use it to get options
            options = await tiddlywikiAPI.getAutoCompleteOptions(autoTrigger, value);
        } else {
            options = await tiddlywikiAPI.searchTiddlers(value);
        }
        if (!options || !options.success) {
            return [];
        }
        return {
            trigger: autoTrigger,
            options: options.data
        };
    }
    return { loadConfigure,
        getAutoCompleteOptions 
    };
}
module.exports = {
    AutoComplete
};
