var util = require('util'),
    url = require('url'),
    EventEmitter = require('events').EventEmitter,
    WebSocket = require('ws'),
    debug = util.debuglog('skyprovider');

function SkyAPIClient(endpoint) {
    EventEmitter.call(this);

    this.connections = {};
    this.interval = null;
    this.endpoint = url.parse(endpoint);
    this.endpoint.protocol = 'ws';
    this.endpoint.search = null;
    this.endpoint.query = null;
}
util.inherits(SkyAPIClient, EventEmitter);

function wsConnect(client, name, endpoint) {
    debug('opening ws on', endpoint);
    var ws = new WebSocket(endpoint);
    ws.on('open', client._onWSOpen.bind(client, name));
    ws.on('close', client._onWSClose.bind(client, name));
    ws.on('error', client._onWSError.bind(client, name));
    return ws;
}
SkyAPIClient.prototype.provideService = function(name, port, opts) {
    debug('provideService', name, port);
    var options = opts || {},
        wsUrl, key, ws;
    if (typeof name !== 'string' || !name) {
        throw new TypeError('Invalid name sent to provideService');
    }
    if (isNaN(parseFloat(port))) {
        throw new TypeError('Invalid port sent to provideService');
    }
    if (this.connections.hasOwnProperty(name)) {
        throw new Error(name + ' is already being provided');
    }
    this.endpoint.query = {
        service: name,
        port: port
    };
    for (key in options) {
        if (options.hasOwnProperty(key)) {
            this.endpoint.query[key] = options[key];
        }
    }
    wsUrl = url.format(this.endpoint);
    ws = wsConnect(this, name, wsUrl);
    this.endpoint.query = null;
    this.connections[name] = {
        url: wsUrl,
        connected: false,
        ws: ws
    };
    if (options.unRef) {
        ws._socket.unref();
    }
    return this;
};
SkyAPIClient.prototype.provide = SkyAPIClient.prototype.provideService;

function cleanup(client, name) {
    delete client.connections[name];
    if (Object.keys(client.connections).length === 0) {
        clearInterval(client.interval);
    }
}

SkyAPIClient.prototype.stopService = function(name) {
    debug('stopService', name);
    if (!this.connections.hasOwnProperty(name)) {
        return;
    }
    if (this.connections[name].ws) {
        if (this.connections[name].connected) {
            this.connections[name].ws.close();
        } else {
            this.connections[name].ws.terminate();
        }
        this.connections[name].ws.removeAllListeners();
    }
    cleanup(this, name);
    this.emit('stopped', name);
};
SkyAPIClient.prototype.stop = SkyAPIClient.prototype.stopService;

SkyAPIClient.prototype.connected = function(name) {
    if (!this.connections.hasOwnProperty(name)) {
        return false;
    }
    return this.connections[name].connected;
};

SkyAPIClient.prototype.ping = function() {
    var foundConnection = false,
        key;
    for (key in this.connections) {
        if (!this.connections.hasOwnProperty(key) || !this.connections[key].ws) {
            continue;
        }
        try {
            this.connections[key].ws.ping();
            foundConnection = true;
        } catch (e) {
            debug('ping failed', e);
            this.stopService(key);
        }
    }
    if (!foundConnection) {
        clearInterval(this.interval);
    }
    return this;
};

SkyAPIClient.prototype._onWSOpen = function(name) {
    debug('_onWSOpen', name);
    if (!this.connections.hasOwnProperty(name)) {
        //it must've been removed...
        return;
    }
    //add an interval if there isn't already one added
    if (this.interval === null) {
        this.interval = setInterval(this.ping.bind(this), 15000);
        this.interval.unref();
    }
    this.connections[name].connected = true;
    this.emit('providing', name);
};

function reconnect(client, name) {
    if (!client.connections.hasOwnProperty(name)) {
        //it must've been removed...
        return;
    }
    client.connections[name].ws.removeAllListeners();
    client.connections[name].ws = null;
    //try to reconnect in 3 seconds
    setTimeout(function() {
        //if it doesn't exist anymore on connections than it was stopped
        //if there already is a ws then it already is trying to connect
        if (client.connections.hasOwnProperty(name) && !client.connections[name].ws) {
            client.connections[name].ws = wsConnect(client, name, client.connections[name].url);
        }
    }, 3000);
}

SkyAPIClient.prototype._onWSClose = function(name) {
    debug('_onWSClose', name);
    reconnect(this, name);
};

SkyAPIClient.prototype._onWSError = function(name, error) {
    debug('_onWSError', name, error);
    reconnect(this, name);
};

module.exports = SkyAPIClient;
