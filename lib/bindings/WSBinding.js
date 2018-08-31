/*
 * Copyright 2016 Telefonica Investigación y Desarrollo, S.A.U
 *
 * This file is part of iotagent-ul
 *
 * iotagent-ul is free software: you can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * iotagent-ul is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with iotagent-ul.
 * If not, seehttp://www.gnu.org/licenses/.
 *
 * For those usages not covered by the GNU Affero General Public License
 * please contact with::[iot_support@tid.es]
 */

'use strict';

const async = require('async'),
    apply = async.apply,
    iotAgentLib = require('iotagent-node-lib'),
    utils = require('../iotaUtils'),
    constants = require('../constants'),
    errors = require('../errors'),
    ulParser = require('../ulParser'),
    request = require('request'),
    config = require('../configService'),
    context = {
        op: 'IOTAUL.WS.Binding'
    },
    transport = 'WS'
    ;

const server = require('http').createServer();
const wss = require('socket.io')(server);
const express = require('express');
const bodyParser = require('body-parser');
const Device = require('../models/Device.js');
const Attribute = require('../models/Attribute.js');
const Command = require('../models/Command.js');
const dbUtils = require('../dbUtils.js');
const app = express();
let miniServer = null;

/**
 * Device provisioning handler. This handler just fills in the transport protocol in case there is none.
 *
 * @param {Object} device           Device object containing all the information about the provisioned device.
 */
function deviceProvisioningHandler(device, callback) {
    console.log('register for device:');
    console.log(JSON.stringify(device));
    if (!device.transport) {
        device.transport = 'WS';
    }

    if (device.transport === 'WS') {
        if (device.endpoint) {
            device.polling = false;
        } else {
            device.polling = true;
        }
    }

    callback(null, device);
}

/**
 * Generate a function that executes the given command in the device.
 *
 * @param {String} apiKey           APIKey of the device's service or default APIKey.
 * @param {Object} device           Object containing all the information about a device.
 * @param {Object} attribute        Attribute in NGSI format.
 * @return {Function}               Command execution function ready to be called with async.series.
 */
function generateCommandExecution(apiKey, device, attribute) {
    var cmdName = attribute.name,
        cmdAttributes = attribute.value,
        options;

    options = {
        url: device.endpoint,
        method: 'POST',
        body: ulParser.createCommandPayload(device, cmdName, cmdAttributes),
        headers: {
            'fiware-service': device.service,
            'fiware-servicepath': device.subservice
        }
    };

    return function sendUlCommandHTTP(callback) {
        var commandObj;

        request(options, function(error, response, body) {
            if (error) {
                callback(new errors.HTTPCommandResponseError('', error, cmdName));
            } else if (response.statusCode !== 200) {
                var errorMsg;

                try {
                    commandObj = ulParser.result(body);
                    errorMsg = commandObj.result;
                } catch (e) {
                    errorMsg = body;
                }

                callback(new errors.HTTPCommandResponseError(response.statusCode, errorMsg, cmdName));
            } else {
                if (apiKey) {
                    commandObj = ulParser.result(body);

                    process.nextTick(utils.updateCommand.bind(
                        null,
                        apiKey,
                        device,
                        commandObj.result,
                        commandObj.command,
                        constants.COMMAND_STATUS_COMPLETED,
                        callback));
                } else {
                    callback();
                }
            }
        });
    };
}

/**
 * Handles a command execution request coming from the Context Broker. This handler should:
 *  - Identify the device affected by the command.
 *  - Send the command to the HTTP endpoint of the device.
 *  - Update the command status in the Context Broker while pending.
 *  - Update the command status when the result from the device is received.
 *
 * @param {Object} device           Device data stored in the IOTA.
 * @param {String} attributes       Command attributes (in NGSIv1 format).
 */
function commandHandler(device, attributes, callback) {
    broadcast(device, attributes);
    utils.getEffectiveApiKey(device.service, device.subservice, function(error, apiKey) {
        async.series(attributes.map(generateCommandExecution.bind(null, apiKey, device)), function(error) {
            if (error) {
                config.getLogger().error(context,
                    'COMMANDS-004: Error handling incoming command for device [%s]', device.id);

                utils.updateCommand(
                    apiKey,
                    device,
                    error.message,
                    error.command,
                    constants.COMMAND_STATUS_ERROR,
                    function(error) {
                        if (error) {
                            config.getLogger().error(context,
                                ' COMMANDS-005: Error updating error information for device [%s]', device.id);
                        }
                    });
            } else {
                config.getLogger().debug('Incoming command for device [%s]', device.id);
            }
        });
    });

    callback();
}

function notificationHandler(device, values, callback) {
    console.log('notification for device:');
    console.log(JSON.stringify(device));
    if (device.endpoint) {
        //sendPushNotifications(device, values, callback);
    } else {
        //storePollNotifications(device, values, callback);
    }
}

function broadcast(data, attributes) {
    const sockets = wss.sockets.sockets;
    for(const socketId in sockets)
    {
        const socket = sockets[socketId];
        config.getLogger().info(context, 'Sending msg to ' + socket.client.conn.remoteAddress);
        socket.emit("onCommandReceived", data, attributes[0]);
    }
}

function startMiniHTTPserver() {
    const port = config.getConfig().iota.miniHTTPserverPort;

    app.use(bodyParser);

    app.post('/', (request, response) => {
        response.send("Hello from knot");
    });

    miniServer = app.listen(port, (err) => {
        if (err) {
            return  config.getLogger().error(context, 'Error while starting mini HTTP server on port %s [%s]',config.getConfig().iota.miniHTTPserverPort ,err);
        }

        config.getLogger().info(context, 'Mini HTTP server is listening on port '+port);
    });
}

function saveNewThing(thing, callback) {
    iotAgentLib.register(thing, function(error, thing) {
        callback(error, thing);
    });
}

function saveNewDevices(devices, callback) {
    for(let i = 0;i < devices.length;i++){
        let d = devices[i];
        iotAgentLib.register(d, function(error, d) {
            callback(error, d);
        });
    }
}

function verifyThing(id, thing_service_path, cb) {
    iotAgentLib.getDevice(id, "knot", thing_service_path, function (error, device) {
        if (!error && device) {
            // We have to remove the thing and its associated devices
            config.getLogger().info(context, 'Same device found in the DB. Deleting it, the devices associated and resuming registry.');

            dbUtils.findByStatic(device.id, function (error, devices) {
                if(error){
                    cb("fail");
                    config.getLogger().error(context, 'Something went wrong while searching for devices');
                }else{
                    for(let i = 0;i < devices.length;i++){
                        let d = devices[i];
                        config.getLogger().debug(context, 'Deleting device '+d.id);
                        iotAgentLib.unregister(d.id, device.service, device.subservice, function (error) {
                            if(error){
                                cb("fail");
                                config.getLogger().error(context, 'Something went wrong while deleting devices');
                            }else{
                                config.getLogger().info(context, 'Duplicated device deleted');
                            }
                        });
                    }
                    config.getLogger().debug(context, 'Deleting thing '+device.id);
                    iotAgentLib.unregister(device.id, device.service, device.subservice, function (error) {
                        if(error){
                            cb("fail");
                            config.getLogger().error(context, 'Something went wrong while deleting thing');
                        }else{
                            config.getLogger().info(context, 'Duplicated thing deleted');
                        }
                    });
                }
            })
        } else if (error.name === 'DEVICE_NOT_FOUND') {
            // Not found means ok here
            config.getLogger().debug(context, 'Device to be added not found in the DB. Continuing the process.');
        } else {
            cb("fail");
            config.getLogger().error(context, 'Something went wrong while searching for thing');
        }
    });
}

function removeThing(id, thing_service_path, cb) {
    iotAgentLib.getDevice(id, "knot", thing_service_path, function (error, device) {
        if (!error && device) {
            // We have to remove the thing and its associated devices
            config.getLogger().info(context, 'Same device found in the DB. Deleting it, the devices associated and resuming.');

            dbUtils.findByStatic(device.id, function (error, devices) {
                if(error){
                    cb(error, null);
                    config.getLogger().error(context, 'Something went wrong while searching for devices');
                }else{
                    for(let i = 0;i < devices.length;i++){
                        let d = devices[i];
                        config.getLogger().debug(context, 'Deleting device '+d.id);
                        iotAgentLib.unregister(d.id, device.service, device.subservice, function (error) {
                            if(error){
                                cb(error, null);
                                config.getLogger().error(context, 'Something went wrong while deleting devices');
                            }else{
                                config.getLogger().info(context, 'Duplicated device deleted');
                            }
                        });
                    }
                    config.getLogger().debug(context, 'Deleting thing '+device.id);
                    iotAgentLib.unregister(device.id, device.service, device.subservice, function (error) {
                        if(error){
                            cb(error, null);
                            config.getLogger().error(context, 'Something went wrong while deleting thing');
                        }else{
                            cb(null, {'device': device, 'devices': devices});
                            config.getLogger().info(context, 'Duplicated thing deleted');
                        }
                    });
                }
            })
        } else if (error.name === 'DEVICE_NOT_FOUND') {
            cb(error.name);
            config.getLogger().debug(context, 'Device to be removed not found in the DB. Continuing the process.');
        } else {
            cb(error, null);
            config.getLogger().error(context, 'Something went wrong while searching for thing');
        }
    });
}

function checkService() {
    request.post({
        headers: {
            "Content-Type": "application/json",
            "fiware-service": "knot_iot",
            "fiware-servicepath": "/knot_iot/knot"
        },
        url: 'http://localhost:'+config.getConfig().iota.server.port+'/iot/services',
        body: "{\n" +
        "\t\"services\": [\n" +
        "\t   {\n" +
        "\t     \"apikey\":      \""+config.getConfig().defaultKey+"\",\n" +
        "\t     \"cbroker\":     \"http://"+config.getConfig().iota.contextBroker.host+":"+config.getConfig().iota.contextBroker.port+"\",\n" +
        "\t     \"entity_type\": \"DEVICE\",\n" +
        "\t     \"resource\":    \""+config.getConfig().iota.defaultResource+"\"\n" +
        "\t   }\n" +
        "\t]\n" +
        "}"
    });
}

    function getDeviceSchema(device) {
        let schema = {};

        schema.sensor_id = parseInt(device.id);

        device.staticAttributes.map((attr) => {
            if(attr.name === 'value_type') {
                schema.value_type = attr.value;
            }
            else if(attr.name === 'unit') {
                schema.unit = attr.value;
            }
            else if(attr.name === 'type_id') {
                schema.type_id = attr.value;
            }
            else if(attr.name === 'name'){
                schema.name = attr.value;
            }
        });

        return schema;
    }


function start(callback) {

    checkService();

    wss.on('connection', function connection(ws) {

        ws.on("addDevice", function (data, cb) {
            // const data = JSON.parse(msg);

            // We need to remove '-' from the id for the servicepath because Orion complains
            const thing_service_path = "/knot/"+data.id.replace(/-/g, '_');

            // Verify if thing exists, and if it does, remove it and the devices associated with it
            verifyThing(data.id, thing_service_path, function (err) {
                if(err){
                    cb("fail");
                }
            });

            // Construct all objects
            const thing = new Device(data.id, "THING", data.id, "knot", thing_service_path);
            thing.protocol = "PDI-IoTA-UltraLight";
            thing.apikey = config.getConfig().defaultKey;
            thing.transport = "WS";
            thing.endpoing = "http://localhost:3001/";
            thing.active.push(new Attribute("status", "String", "OFFLINE"));
            thing.staticAttributes.push(new Attribute("name", "String", data.name));


            // Send thing and its devices to be saved
            async.waterfall([
                apply(saveNewThing, thing)
            ], function (error, device) {
                if(error){
                    cb("fail");
                    config.getLogger().error(context, 'Error creating device [%s]', device.id);
                }else{
                    cb("ok");
                    config.getLogger().info(context, 'Created device [%s]', device.id);
                }
            });

            console.log('add received: %s from %s', msg, ws.client.conn.remoteAddress);
        });

        ws.on("updateSchema", function (id, data, cb) {
            // const data = JSON.parse(msg);

            // We need to remove '-' from the id for the servicepath because Orion complains
            const thing_service_path = "/knot/"+id.replace(/-/g, '_');

            const devices = [];
            for(let i = 0;i < data.length;i++){
                let d = data[i];
                const device = new Device(d.sensor_id, "DEVICE", d.sensor_id, "knot", thing_service_path);
                device.protocol = "PDI-IoTA-UltraLight";
                device.transport = "WS";
                device.endpoing = "http://localhost:3001/";
                device.apikey = config.getConfig().defaultKey;
                device.active.push(new Attribute("value", "String", null));
                device.staticAttributes.push(new Attribute("thing", "String", id));
                device.staticAttributes.push(new Attribute("value_type", "Integer", d.value_type));
                device.staticAttributes.push(new Attribute("unit", "Integer", d.unit));
                device.staticAttributes.push(new Attribute("type_id", "Integer", d.type_id));
                device.staticAttributes.push(new Attribute("name", "String", d.name));
                device.commands.push(new Command("command", "command", null));
                devices.push(device);
            }

            // Send thing and its devices to be saved
            async.waterfall([
                apply(saveNewDevices, devices)
            ], function (error, device) {
                if(error){
                    cb("fail");
                    config.getLogger().error(context, 'Error creating device [%s]', device.id);
                }else{
                    cb("ok");
                    config.getLogger().error(context, 'Created device [%s]', device.id);
                }
            });

            console.log('update schema received: %s from %s', data, ws.client.conn.remoteAddress);
        });

        ws.on("removeDevice", function (id, cb) {

            const tsp = "/knot/"+id.replace(/-/g, '_');

            removeThing(id, tsp, function (err, data) {
                if(err || data === null){
                    cb(err);
                }else{
                    // TODO: removeThing should remove from orion not the code below
                    utils.deleteFromOrionById( data.device.id, 'THING', tsp);
                    for(let i = 0;i < data.devices.length;i++){
                        utils.deleteFromOrionById(data.devices[i].id, 'DEVICE', tsp);
                    }
                    cb("ok");
                }
            });

            console.log('remove received: %s from %s', id, ws.client.conn.remoteAddress);
        });

        ws.on("publishData", function (id, dataList, cb) {
            const information_type = {
                type : "DEVICE",
                service : "knot",
                subservice : "/knot/"+id.replace(/-/g, '_'),
                cbhost: config.getConfig().iota.contextBroker.host+":"+config.getConfig().iota.contextBroker.port
            };

            if (dataList === undefined || dataList.length === 0) {
                cb("fail");
            }

            dataList.forEach(function (data) {
                const orionData = [
                    {
                        "name": "value",
                        "type": "String",
                        "value": data.value.toString()
                    }
                ];
                iotAgentLib.update(data.sensor_id, "DEVICE", config.getConfig().defaultKey, orionData, information_type, function (err) {
                    if(err){
                        cb("fail");
                    }else{
                        cb("ok");
                    }
                });
            });

            console.log('update received from %s', ws.client.conn.remoteAddress);
        });

        ws.on('updateProperties', function (id, data, cb) {
            const information_type = {
                type : "THING",
                service : "knot",
                subservice : "/knot/"+id.replace(/-/g, '_'),
                cbhost: config.getConfig().iota.contextBroker.host+":"+config.getConfig().iota.contextBroker.port
            };

            iotAgentLib.getDevice(id, information_type.service, information_type.subservice, function (error, device) {
                if (!error && device) {
                    let i = 0;
                    const attrs = [];
                    for (let k in data) {
                        i++;
                        if (data.hasOwnProperty(k)) {
                            device.staticAttributes.push({"name": ""+k, "type": "String", "value": ""+data[k]});
                            attrs.push({"name": ""+k, "type": "String", "value": ""+data[k]});
                        }
                        if(Object.keys(data).length === i){
                            iotAgentLib.updateRegister(device, function (err, oldD, newD) {
                                if(err){
                                    cb("fail");
                                }else{
                                    iotAgentLib.update(id, "THING", config.getConfig().defaultKey, attrs, information_type, function (err) {
                                        if(err){
                                            cb("fail");
                                        }else{
                                            cb("ok");
                                        }
                                    });
                                }
                            });
                        }
                    }
                } else if (error.name === 'DEVICE_NOT_FOUND') {
                    cb("fail");
                    config.getLogger().debug(context, 'Device to be removed not found in the DB. Continuing the process.');
                } else {
                    cb("fail");
                    config.getLogger().error(context, 'Something went wrong while searching for thing');
                }
            });
        });

        ws.on('listDevices', function (cb) {
            let data = [];

            dbUtils.findByService("knot", "THING", function (err, things) {
                if (things === undefined || things.length === 0) {
                    cb([]);
                }

                things.forEach(function (thing, index) {
                    let name = '';

                    thing.staticAttributes.filter(attr => attr.name === 'name').map(data => name = data.value);
                    dbUtils.findOneBySubService(thing.subservice, "DEVICE", function (err, device) {
                        data.push({id: thing.id, name: name, schema: [getDeviceSchema(device)]});
                        if (index === things.length - 1) {
                            cb(data);
                        }
                    });
                });
            });

            console.log('List devices received from %s', ws.client.conn.remoteAddress);
        });

        ws.on('message', function incoming(msg) {
            console.log('message received: %s from %s', msg, ws.client.conn.remoteAddress);
            ws.send('RECEIVED "'+msg+'"');
        });

        ws.on('close', function () {
            console.log(ws.client.conn.remoteAddress+' websocket connection closed!');
        });

        ws.on('error', function () {
            console.log(ws.client.conn.remoteAddress+' websocket error!!!');
        });

        console.log('websocket connection opened from '+ws.client.conn.remoteAddress+' .');
        ws.send('CONNECTED');
    });

    server.listen(config.getConfig().iota.socketIOport);

    config.getLogger().info(context, 'WS Binding listening on port [%s]', config.getConfig().iota.socketIOport);

    startMiniHTTPserver();
}

function stop(callback) {
    config.getLogger().info(context, 'Stopping Ultralight WS Binding: ');
    server.close();
    config.getLogger().info(context, 'Stopping Mini HTTP server');
    miniServer.close();
}

exports.start = start;
exports.stop = stop;
exports.deviceProvisioningHandler = deviceProvisioningHandler;
exports.notificationHandler = notificationHandler;
exports.commandHandler = commandHandler;
exports.protocol = 'WS';
