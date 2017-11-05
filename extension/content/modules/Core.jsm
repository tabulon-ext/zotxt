/**
 * Parses an easy key. Returns {creator: ..., title: ..., date: ...} or null if it
 * did not parse correctly.
 */
function parseEasyKey(key, xregexp) {
    const easyKeyRe = xregexp('^(\\p{Lu}[\\p{Ll}_-]+)(\\p{Lu}\\p{Ll}+)?([0-9]{4})?');
    const alternateEasyKeyRe = xregexp('^([\\p{Ll}_-]+):([0-9]{4})?(\\p{Ll}+)?');
    let result = easyKeyRe.exec(key);
    if (result) {
        return {creator: result[1], title: result[2], date: result[3]};
    } else {
        result = alternateEasyKeyRe.exec(key);
        if (result) {
            return {creator: result[1], title: result[3], date: result[2]};
        } else {
            return null;
        }
    }
}

function fixStyleId(styleId) {
    if (!styleId) {
        return  'http://www.zotero.org/styles/chicago-note-bibliography';
    } else if (!styleId.match(/^http:/)) {
        return 'http://www.zotero.org/styles/' + styleId;
    } else {
        return styleId;
    }
}

/**
 * Prepare query values for us.
 */
function cleanQuery(q) {
    let retval = [];
    for (let key in q) {
        retval[key] = q[key].replace('+', ' ');
    }
    return retval;
}

/* Given a iterable of promises that return an item, return a deduped iterable
 * of promises (based on the id). */
function dedupItems(items, zotero) {
    let seenIds = new Set([]); // To uniqify results
    return zotero.Promise.filter(items, (item) => {
        if (seenIds.has(item.id)) {
            return false;
        } else {
            seenIds.add(item.id);
            return true;
        }
    });
};

function item2key(item) {
    return ((item.libraryID || '1') + '_' + item.key);
}

function findByKey(key, zotero) {
    if (key.indexOf('/') !== -1) {
        let lkh = zotero.Items.parseLibraryKey(key);
        return zotero.Items.getByLibraryAndKeyAsync(lkh.libraryID, lkh.key);
    } else {
        return zotero.Items.getByLibraryAndKeyAsync(1, key);
    }
}

function makeCslEngine (styleId, zotero) {
    let style = zotero.Styles.get(fixStyleId(styleId));
    if (!style) {
        return null;
    } else {
        // jshint camelcase: false
        let csl = style.getCiteProc();
        csl.opt.development_extensions.wrap_url_and_doi = true;
        return csl;
    }
}

function getItemOrParent(item, zotero) {
    // not Regular item or standalone note/attachment
    if (!item.isRegularItem() && item.parentKey) {
        return findByKey(item.parentKey, zotero);
    } else {
        return item;
    }
}

function rawSearch(key, zotero) {
    let s = new zotero.Search();
    let str = '@' + key;
    s.addCondition('joinMode', 'any');
    s.addCondition('tag', 'is', str);
    s.addCondition('note', 'contains', str);
    return runSearch(s, zotero);
}

const toExport = [parseEasyKey, fixStyleId, cleanQuery, dedupItems, item2key, findByKey, makeCslEngine, getItemOrParent, rawSearch];

var EXPORTED_SYMBOLS = toExport.map((f) => { return f.name; } );

if (typeof process !== 'undefined') {
    toExport.forEach((s) => { module.exports[s.name] = s; });
}
