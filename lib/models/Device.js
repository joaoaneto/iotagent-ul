function Construct(id, type, name, service, subservice){
    this.id = id;
    this.type = type;
    this.name= name;
    this.lazy = [];
    this.active = [];
    this.commands = [];
    this.apikey = null;
    this.endpoing = null;
    this.resource = null;
    this.protocol = null;
    this.transport = null;
    this.staticAttributes = [];
    this.subscriptions = null;
    this.service = service;
    this.subservice = subservice;
    this.polling = null;
    this.timezone = null;
    this.registrationId = null;
    this.internalId = null;
    this.internalAttributes = [];
}

module.exports = Construct;