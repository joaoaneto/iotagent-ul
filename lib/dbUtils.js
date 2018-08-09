const mongoose = require('mongoose').set('debug', true);
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

function findByService(service, type, callback) {
    mongoose.model('Devices', Device.internalSchema).find({service: service, type: type} ,function (err, devices) {
        if (err) {
            callback(err, null);
        } else {
            callback(err, devices);
        }
    });
}

exports.findByStatic = findByStatic;
exports.findByService = findByService;