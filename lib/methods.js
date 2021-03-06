'use strict';

var Helpers = require('./helpers.js');

var Listings = require('../index.js');

Listings.prototype.getListings = function (callback) {
    this._retry(Listings.prototype._get.bind(this), callback);
};

Listings.prototype.createListings = function (listings, update = false) {
    if (!this.ready) {
        throw new Error("Please initialize before you do anything");
        return;
    }

    clearTimeout(this._wait);

    for (var i = 0; i < listings.length; i++) {
        if (listings[i].intent == 0) {
            var listing = this._parseListing(listings[i]);
            if (listing == null) {
                continue;
            }

            listings[i] = listing;
        }
    }

    if (update == true) {
        for (var i = 0; i < listings.length; i++) {
            var listing = listings[i];
            var found = this._findListing(listing.intent == 1 ? listing.id : listing.item, listing.intent);
            if (found != null) {
                this.actions.remove.push(found.id);
            }
        }
    }

    this.actions.create = this.actions.create.concat(listings);
    this.emit('actions', this.actions.create, this.actions.remove);
    this._wait = setTimeout(Listings.prototype._retry.bind(this, Listings.prototype._action.bind(this, this.actions)), this.waitTime);
};

Listings.prototype.createListing = function (listing, update = false) {
    if (!this.ready) {
        throw new Error("Please initialize before you do anything");
        return;
    }

    listing = this._parseListing(listing);
    if (listing == null) {
        return;
    }

    clearTimeout(this._wait);

    if (update == true) {
        var found = this._findListing(listing.intent == 1 ? listing.id : listing.item, listing.intent);
        if (found != null && Helpers.epoch() - found.created <= 30 * 60) {
            this.actions.remove.push(found.id);
        }
    }

    this.actions.create.push(listing);
    this.emit('actions', this.actions.create, this.actions.remove);
    this._wait = setTimeout(Listings.prototype._retry.bind(this, Listings.prototype._action.bind(this, this.actions)), this.waitTime);
};

Listings.prototype._parseListing = function (listing) {
    if (listing.intent == 0) {
        var item = this._parse(listing.item);
        if (item == null) {
            return null;
        }
        listing.item = item;
    }

    return listing;
};

// Get item from listing.
Listings.prototype.getItem = function (item) {
    var parse = {
        defindex: item.defindex,
        quality: item.quality,
        craftable: !(item.hasOwnProperty('flag_cannot_craft') && item.flag_cannot_craft == true),
        killstreak: 0,
        australium: false
    };

    if (item.hasOwnProperty('attributes')) {
        for (var i = 0; i < item.attributes.length; i++) {
            var attribute = item.attributes[i];
            if (attribute.defindex == 2025) {
                parse.killstreak = attribute.float_value;
            } else if (attribute.defindex == 2027) {
                parse.australium = true;
            } else if (attribute.defindex == 134) {
                parse.effect = attribute.float_value;
            }
        }
    }

    return parse;
};

// Parse an item so that it looks like an item from the bptf api.
Listings.prototype._parseItem = function (item) {
    var parse = this.getItem(item);
    parse = this._parse(parse);
    return parse;
};

Listings.prototype._findListing = function (search, intent) {
    for (var i = 0; i < this.listings.length; i++) {
        var listing = this.listings[i];
        if (listing.intent == intent && listing.intent == 1 && listing.item.id == search) {
            return listing;
        } else if (listing.intent == intent && listing.intent == 0) {
            var item = this._parseItem(listing.item);
            if (item.item_name == search.item_name && item.quality == search.quality && item.craftable == search.craftable && item.priceindex == search.priceindex) {
                return listing;
            }
        }
    }

    return null;
};

Listings.prototype._parse = function (parse) {
    var schema = this.items.schema.getItem(parse.defindex);
    if (schema == null) {
        this.emit('error', item.defindex || '', 'Not a valid / missing defindex');
        return null;
    }

    var quality = this.items.schema.getQuality(parse.quality);

    var item = {
        defindex: parse.defindex,
        quality: quality == null ? 6 : parse.quality,
        craftable: parse.craftable || false,
        killstreak: parse.killstreak || 0,
        australium: parse.australium || false
    };

    var name = this.items.schema.getDisplayName(item);

    // We want to remove "The" if propername is true since bptf uses the item_name without checking proper_name.
    if (name.startsWith('The ') && schema.proper_name === true) {
        name = name.substring(4);
    }
    if (item.quality != 6) {
        name = name.replace(quality + ' ', '');
    }
    if (item.craftable == false) {
        name = name.replace('Non-Craftable ', '');
    }

    var parsed = {
        item_name: name,
        quality: item.quality,
        craftable: item.craftable == true ? 1 : 0
    };

    if (parse.effect) {
        parsed.priceindex = parse.effect;
    }

    return parsed;
};

Listings.prototype.removeListings = function (ids) {
    if (!this.ready) {
        throw new Error("Please initialize before you do anything");
        return;
    }

    clearTimeout(this._wait);

    this.actions.remove = this.actions.remove.concat(ids);
    this.emit('actions', this.actions.create, this.actions.remove);
    this._wait = setTimeout(Listings.prototype._retry.bind(this, Listings.prototype._action.bind(this, this.actions)), this.waitTime);
};

Listings.prototype.removeListing = function (id) {
    if (!this.ready) {
        throw new Error("Please initialize before you do anything");
        return;
    }

    clearTimeout(this._wait);

    this.actions.remove.push(id);
    this.emit('actions', this.actions.create, this.actions.remove);
    this._wait = setTimeout(Listings.prototype._retry.bind(this, Listings.prototype._action.bind(this, this.actions)), this.waitTime);
};

Listings.prototype.sendHeartbeat = function () {
    this._retry(Listings.prototype._heartbeat.bind(this));
};

Listings.prototype.updateInventory = function () {
    this._retry(Listings.prototype._inventory.bind(this));
};

Listings.prototype._retry = function (method, callback, attempts = 0) {
    var self = this;
    method(function (err, response) {
        attempts++;
        if (self.retry == true && err && attempts < 3 && validReasonToRetry(err)) {
            setTimeout(Listings.prototype._retry.bind(self, method, callback, attempts), err.retryAfter || self.retryTime);
        } else if (callback) {
            callback(err, response);
        }
    });
};

function validReasonToRetry(err) {
    if (err.hasOwnProperty('code') && (err.code == 429 || err.code == 500)) {
        return true;
    }
    return false;
}