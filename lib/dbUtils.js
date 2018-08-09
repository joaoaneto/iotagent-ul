const mongoose = require('mongoose');
const Device = require('./models/DeviceDB.js');
const Config = require('./../config.js');
Device.load(mongoose);

mongoose.connect('mongodb://'+Config.iota.mongodb.host+':'+Config.iota.mongodb.port+'/'+Config.iota.mongodb.db, { useNewUrlParser: true });

function findByStatic(thing_id, callback) {
    mongoose.model('Device', Device.internalSchema).find({"staticAttributes": {"$elemMatch": {"name": "thing", "value": thing_id}}} ,function (err, devices) {
        if (err) {
            callback(err, null);
        } else {
            callback(err, devices);
        }
    });
}

function getDeviceById(id, service, subservice, callback) {
    var query,
        queryParams = {
            id: id,
            service: service,
            subservice: subservice
        };

    console.log('Looking for entity with id [%s].', id);

    query = Device.model.findOne(queryParams);
    query.select({__v: 0});

    query.exec(function handleGet(error, data) {
        if (error) {
            console.log('Internal MongoDB Error getting device: %s', error);

            callback(new errors.InternalDbError(error));
        } else if (data) {
            callback(null, data);
        } else {
            console.log('Entity [%s] not found.', id);

            callback(new errors.DeviceNotFound(id));
        }
    });
}

exports.findByStatic = findByStatic;