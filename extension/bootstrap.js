// This file is part of zotxt.

// zotxt is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// Foobar is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with Foobar.  If not, see <http://www.gnu.org/licenses/>.

/* global Components, Set, FileUtils, NetUtil, Q, parseEasyKey, runSearch, buildRawSearch, buildEasyKeySearch, findByKey, cleanQuery, buildSearch, makeCslEngine, findByEasyKey, findByBBTKey, jsonStringify, item2key */
'use strict';

Components.utils.import('resource://gre/modules/Services.jsm');

var Zotero;
var uuidRe = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/;
var timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);

let easyKeyExporterMetadata = {
    'translatorID':'9d774afe-a51d-4055-a6c7-23bc96d19fe7',
    'label': 'Easy Citekey',
    'creator': 'Erik Hetzner',
    'target': 'txt',
    'minVersion': '2.1.9',
    'maxVersion': '',
    'priority': 200,
    'inRepository': false,
    'translatorType': 2,
    'browserSupport': 'gcs',
    'displayOptions': {
        'Alternate (@DoeTitle2000)': false
    },
    'lastUpdated':'2013-07-15 07:03:17'
};

const jsonMediaType = 'application/json; charset=UTF-8';
const textMediaType = 'text/plain';
const badRequestCode = 400;
const okCode = 200;

function loadZotero () {
    let callback = function (resolve, reject) {
        if (!Zotero) {
            if (!("@zotero.org/Zotero;1" in Components.classes)) {
                return timer.initWithCallback(function () {
                    return callback(resolve, reject);
                }, 10000, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
            } else {
                Zotero = Components.classes["@zotero.org/Zotero;1"]
                    .getService(Components.interfaces.nsISupports).wrappedJSObject;
                return resolve(Zotero);
            }
        } else {
            return resolve(Zotero);
        }
    };
    return new Promise(callback);
}

function getCollection(name, collections) {
    if (!collections) {
        return getCollection(name, Zotero.getCollections(null));
    } else {
        for (let collection of collections) {
            if (collection.name === name) {
                return collection;
            } else {
                if (collection.hasChildCollections) {
                    let retval = getCollection(name, Zotero.getCollections(collection.id));
                    if (retval) return retval;
                }
            }
        }
        return null;
    }
}

function collectionSearch(name) {
    let collection = getCollection(name);
    if (!collection) {
        return [];
    } else {
        return collection.getChildItems();
    }
}

function processCitationItem (citation) {
    let cloneButSetId = (item)=>{
        let retval = Object.assign({}, citation);
        retval.id = item.id;
        delete(retval.easyKey);
        delete(retval.key);
        return retval;
    };
    if ('easyKey' in citation) {
        return findByEasyKey(citation.easyKey, Zotero).then(cloneButSetId);
    } else if ('key' in citation) {
        return findByKey(citation.key, Zotero).then(cloneButSetId);
    } else {
        return Promise.resolve(citation);
    }
}

/**
 * Map the easykeys in the citations to ids.
 */
function processCitationsGroup (citationGroup) {
    let citationItems = citationGroup.citationItems.map(processCitationItem);
    return Promise.all(citationItems).then((items)=>{
        return {
            'properties': citationGroup.properties,
            'citationItems': items
        };
    });
}

/**
 * Extract the ids from an array of citationGroups.
 */
function extractIds (citationGroups) {
    let ids = [];
    citationGroups.map (function(group) {
        group.citationItems.map (function(citationItem) {
            ids.push(citationItem.id);
        });
    });
    return ids;
}

function myExport (items, translatorId) {
    let callback = function (resolve, reject) {
        let translation = new Zotero.Translate.Export();
        translation.setItems(items);
        translation.setTranslator(translatorId);
        /* I don't understand why Zotero still has `setHandler` now that we are in
         * promise-land, but OK */
        translation.setHandler("done", function (obj, worked) {
            if (worked) {
                resolve(obj.string);
            } else {
                reject();
            }
        });
        if (translatorId === 'a515a220-6fef-45ea-9842-8025dfebcc8f') {
            translation.setDisplayOptions({quickCopyMode: 'citekeys'});
        }
        translation.translate();
    };
    let promise = new Promise(callback);
    return promise;
}

/**
 * Build a response based on items and a format parameter.
 */
function buildResponse(items, format, style) {
    if (format === 'key') {
        return [okCode, 'application/json', jsonStringify(items.map(item2key))];
    } else if (format === 'easykey') {
        return buildEasyKeyResponse(items);
    } else if (format === 'betterbibtexkey') {
        return buildBBTKeyResponse(items);
    } else if (format === 'bibtex') {
        return buildBibTeXResponse(items);
    } else if (format === 'bibliography') {
        return buildBibliographyResponse(items, style);
    } else if (format && format.match(uuidRe)) {
        return buildExportResponse(items, format);
    } else {
        return buildJsonResponse(items);
    }
}

function buildJsonResponse(items) {
    /* Use BetterBibTeX JSON if available */
    if (Zotero.BetterBibTeX) {
        return buildExportResponse(items, 'f4b52ab0-f878-4556-85a0-c7aeedd09dfc');
    } else {
        return buildExportResponse(items, 'bc03b4fe-436d-4a1f-ba59-de4d2d7a63f7');
    }
}

/**
 * Build a response of a set of citation keys based on a set of items and a
 * translatorId via the Zotero export process.
 */
function buildKeyResponse(items, translatorId) {
        if (items.length === 0) {
            return [okCode, 'application/json', jsonStringify([])];
        } else {
            return myExport(items, translatorId).then((rawKeys)=>{
                let keys = rawKeys.split(/[ ,]/);
                // remove leading @
                let keys2 = keys.map(function(key) { return key.replace(/[\[\]@]/g, ''); });
                return [okCode, jsonMediaType, jsonStringify(keys2)];
            });
        }
}

function buildEasyKeyResponse(items) {
    return buildKeyResponse(items, easyKeyExporterMetadata.translatorID);
}

function buildBBTKeyResponse(items) {
    if (!Zotero.BetterBibTeX) {
        return [badRequestCode, textMediaType, 'BetterBibTex not installed.'];
    } else {
        return buildKeyResponse(items, 'a515a220-6fef-45ea-9842-8025dfebcc8f');
    }
}

function buildExportResponse(items, translatorId) {
    return myExport(items, translatorId).then((data) => {
        return [okCode, textMediaType, data];
    });
}

function buildBibTeXResponse(items) {
    return buildExportResponse(items, '9cb70025-a888-4a29-a210-93ec52da40d4');
}

function buildBibliographyResponse(items, style) {
    let csl = makeCslEngine(style, Zotero);
    let responseData = items.map ((item)=>{
        csl.updateItems([item.id], true);
        return {
            'key': ((item.libraryID || '0') + '_' + item.key),
            'html': Zotero.Cite.makeFormattedBibliography(csl, 'html'),
            // strip newlines
            'text': Zotero.Cite.makeFormattedBibliography(csl, 'text').replace(/(\r\n|\n|\r)/gm,'')
            };
    });
    return [okCode, jsonMediaType, jsonStringify(responseData)];
}

function handleErrors(f) {
    return (...args)=>{
        return f(...args).catch((ex)=>{
            return [500, textMediaType, (ex && ex.message)];
        });
    };
}

let bibliographyEndpoint = handleErrors((options)=>{
    let cslEngine = makeCslEngine(options.data.styleId, Zotero);
    if (!cslEngine) {
        return [badRequestCode, textMediaType, 'No style found.'];
    } else {
        //zotero.localItems = {};
        cslEngine.setOutputFormat('html');
        let groups = options.data.citationGroups.map(processCitationsGroup);
        return Promise.all(groups).then((citationGroups)=>{
            cslEngine.updateItems(extractIds(citationGroups));
            let retval = {};
            retval.bibliography = cslEngine.makeBibliography();
            retval.citationClusters = [];
            citationGroups.map (function (citationGroup) {
		        cslEngine.appendCitationCluster(citationGroup).map(function(updated) {
		            retval.citationClusters[updated[0]] = updated[1];
		        });
	        });
            return [okCode, jsonMediaType, jsonStringify(retval)];
        });
    }
});

let completeEndpoint = handleErrors((options)=>{
    if (!options.query.easykey) {
        return [badRequestCode, textMediaType, 'Option easykey is required.'];
    } else {
        let q = cleanQuery(options.query);
        return runSearch(buildEasyKeySearch(new Zotero.Search(), parseEasyKey(q.easykey, Zotero)), Zotero).then(function (items) {
            if (!items) {
                return [badRequestCode, textMediaType, 'EasyKey must be of the form DoeTitle2000 or doe:2000title'];
            } else {
                return buildEasyKeyResponse(items);
            }
        });
    }
});

const searchEndpoint = handleErrors((options)=>{
    const query = cleanQuery(options.query);
    if (query.q) {
        let search = buildSearch(new Zotero.Search(), query.q, query.method);
        return runSearch(search, Zotero).then((items)=>{
            return buildResponse(items, query.format, query.style);
        });
    } else {
        return [badRequestCode, textMediaType, 'q param required.'];
    }
});

let selectEndpoint = handleErrors((options)=>{
    let ZoteroPane = Components.classes['@mozilla.org/appshell/window-mediator;1'].
            getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow('navigator:browser').ZoteroPane;
    ZoteroPane.show();
    let q = cleanQuery(options.query);
    let promise = null;
    if (q.easykey) {
        promise = findByEasyKey(q.easykey, Zotero);
    } else if (q.key) {
        promise = findByKey(q.key, Zotero);
    } else if (q.betterbibtexkey) {
        promise = findByBBTKey(q.betterbibtexkey, Zotero);
    } else {
        return [badRequestCode, textMediaType, 'No param supplied!'];
    }
    return promise.then(function(item) {
        if (item === false) {
            return [badRequestCode, textMediaType, 'item with key ' + q.key + ' not found!'];
        }
        ZoteroPane.selectItem(item.id);
        return [okCode, jsonMediaType, jsonStringify('success')];
    });
});

let itemsEndpoint = handleErrors((options)=>{
    const q = cleanQuery(options.query);
    let items = [];
    if (q.selected) {
        return buildResponse(Zotero.getActiveZoteroPane().getSelectedItems(), q.format);
    } else if (q.key) {
        let keys = q.key.split(',');
        return Promise.all(
            keys.map((key)=>{
                return findByKey(key, Zotero);
            })).then((items)=>{
                return buildResponse(items, q.format);
            });
    } else if (q.easykey) {
        let keys = q.easykey.split(',');
        return Promise.all(
            keys.map((key) => {
                return findByEasyKey(key, Zotero);
            })).then((items)=>{
                return buildResponse(items, q.format);
            });
    } else if (q.betterbibtexkey) {
        let keys = q.betterbibtexkey.split(',');
        return Promise.all(
            keys.map((key) => {
                return findByBBTKey(key, Zotero);
            })).then((items)=>{
                return buildResponse(items, q.format);
            });
    } else if (q.all) {
        return Zotero.Items.getAll(Zotero.Libraries.userLibraryID).then((items)=>{
            return buildResponse(items, q.format);
        });
    } else {
        return [badRequestCode, textMediaType, 'No param supplied!'];
    }
});

/**
 * Function to load our endpoints into the Zotero connector server.
 */
function loadEndpoints () {
    loadZotero().then(function () {
        let endpoints = {
            'complete' : {
                supportedMethods: ['GET'],
                supportedDataType : ['application/x-www-form-urlencoded'],
                init : completeEndpoint
            },
            'bibliography' : {
                supportedMethods: ['POST'],
                supportedDataType: ['application/x-www-form-urlencoded'],
                init: bibliographyEndpoint
            },
            'search' : {
                supportedMethods: ['GET'],
                supportedDataType : ['application/x-www-form-urlencoded'],
                init : searchEndpoint
            },
            'select' : {
                supportedMethods:['GET'],
                supportedDataType : ['application/x-www-form-urlencoded'],
                init : selectEndpoint
            },
            'items' : {
                supportedMethods:['GET'],
                supportedDataType : ['application/x-www-form-urlencoded'],
                init : itemsEndpoint
            }

        };
        for (let e in endpoints) {
            let ep = Zotero.Server.Endpoints['/zotxt/' + e] = function() {};
            ep.prototype = endpoints[e];
        }
    });
}

let observerService = Components.classes['@mozilla.org/observer-service;1'].
        getService(Components.interfaces.nsIObserverService);

let startupObserver = {
    'observe': function(subject, topic, data) {
        loadZotero().then(function () {
            Components.utils.import('resource://gre/modules/FileUtils.jsm');
            Components.utils.import('resource://gre/modules/NetUtil.jsm');

            /* turn on http server if it is not on */
            /* TODO turn this off when uninstalled? */
            let prefs = Components.classes['@mozilla.org/preferences-service;1']
                .getService(Components.interfaces.nsIPrefService).getBranch('extensions.zotero.');
            prefs.setBoolPref('httpServer.enabled', true);

            /* load exporters */
            // installTranslator(easyKeyExporterMetadata, 'EasyKeyExporter.js');

            loadEndpoints();
        });
    }
};

function startup(data, reason) {
    /* wait until after zotero is loaded */
    observerService.addObserver(startupObserver, 'final-ui-startup', false);
    Components.utils.import('chrome://zotxt/content/modules/Core.jsm');
}


function shutdown (data, reason) {
    observerService.removeObserver(startupObserver, 'final-ui-startup');
}

function uninstall(data, reason) {
    /* TODO uninstall exporters? */
}

function installTranslator(metadata, filename) {
    let file = FileUtils.getFile('ProfD', ['extensions', 'zotxt@e6h.org',
                                           'resource', 'translators', filename]);
    NetUtil.asyncFetch(file, function(inputStream, status) {
        if (!Components.isSuccessCode(status)) {
            Zotero.debug('error reading file');
            return;
        }

        let data = NetUtil.readInputStreamToString(inputStream, inputStream.available());
        Zotero.Translators.save(metadata, data);
        Zotero.Translators.init();
    });
}

function install(data, reason) {
    Components.utils.import('resource://gre/modules/FileUtils.jsm');
    Components.utils.import('resource://gre/modules/NetUtil.jsm');

    /* turn on http server if it is not on */
    /* TODO turn this off when uninstalled? */
    loadZotero().then(function () {
        let prefs = Components.classes['@mozilla.org/preferences-service;1']
            .getService(Components.interfaces.nsIPrefService).getBranch('extensions.zotero.');
        prefs.setBoolPref('httpServer.enabled', true);
        loadEndpoints();

        /* load exporters */
        installTranslator(easyKeyExporterMetadata, 'EasyKeyExporter.js');
    });
}
