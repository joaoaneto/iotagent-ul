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
    mongoose.model('Devices', Device.internalSchema).find({service: service, type: type} ,function (err, things) {
        for(let i = 0;i < things.length;i++){
            findByStatic(things[i].id, function (error, devices) {
                things[i].devices = devices;
                if(i === things.length - 1){
                    if (err || error) {
                        callback(err, null);
                    } else {
                        callback(err, things);
                    }
                }

            });
        }

    });
}

exports.findByStatic = findByStatic;
exports.findByService = findByService;