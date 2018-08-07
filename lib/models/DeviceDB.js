'use strict';

let mongoose = require('mongoose'),
    Schema = mongoose.Schema;

let Device = new Schema({
    id: String,
    type: String,
    name: String,
    lazy: Array,
    active: Array,
    commands: Array,
    apikey: String,
    endpoint: String,
    resource: String,
    protocol: String,
    transport: String,
    staticAttributes: Array,
    subscriptions: Array,
    service: String,
    subservice: String,
    polling: Boolean,
    timezone: String,
    registrationId: String,
    internalId: String,
    creationDate: { type: Date, default: Date.now },
    internalAttributes: Object
});

function load(db) {
    module.exports.model = db.model('Device', Device);
    module.exports.internalSchema = Device;
}

module.exports.load = load;