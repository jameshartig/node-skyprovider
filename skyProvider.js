var util = require('util'),
    url = require('url'),
    EventEmitter = require('events').EventEmitter,
    WebSocket = require('ws'),
    Log = require('modulelog')('skyprovider'),
    srv = require('srvclient');

function SkyAPIClient(endpoint, options) {
    EventEmitter.call(this);

    this.connections = {};
    this.interval = null;
    this.endpoint = url.parse(endpoint);
    if (!this.endpoint.protocol) {
        this.endpoint.protocol = 'ws';
    }
    this.endpoint.search = null;
    this.endpoint.query = null;
    this.options = options || {};
    if (!this.options.hasOwnProperty('reconnect')) {
        this.options.reconnect = true;
    }
    if (!this.options.hasOwnProperty('reconnectDelay')) {
        this.options.reconnectDelay = 3000;
    }
    if (!this.options.hasOwnProperty('pingInterval')) {
        this.options.pingInterval = 15000;
    }
}
util.inherits(SkyAPIClient, EventEmitter);

// returns a copy of urlObj
function resolve(endpoint, cb) {
    var urlObj = url.parse(endpoint);
    // if we already have a port then don't bother resolving with SRV
    if (urlObj.port) {
        cb(urlObj);
        return;
    }
    // if we don't have a port try getting one from SRV
    srv.getRandomTarget(urlObj.host || urlObj.hostname, function(err, target) {
        if (!err && target) {
            Log.debug('Resolved SkyAPI endpoint to', {host: target.name, port: target.port});
            var copy = url.parse(url.format(urlObj), true);
            copy.hostname = target.name;
            copy.port = target.port;
            copy.host = '';
            cb(copy);
        } else {
            //since we failed set the port to the default one
            urlObj.port = urlObj.protocol === 'wss' ? 443 : 80;
            cb(urlObj);
        }
    }.bind(this));
}

function wsConnect(client, name, endpoint) {
    Log.info('Opening SkyAPI connection', {endpoint: endpoint});
    resolve(endpoint, function(urlObj) {
        var urlStr = url.format(urlObj),
            ws = new WebSocket(urlStr);
        client._registerWS(ws, name);
        ws.on('open', client._onWSOpen.bind(client, name));
        ws.on('close', client._onWSClose.bind(client, name));
        ws.on('error', client._onWSError.bind(client, name));
    });
}
SkyAPIClient.prototype.provideService = function(name, port, opts) {
    Log.info('Providing SkyAPI service', {name: name, port: port});
    var options = opts || {},
        wsUrl, key;
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
    this.connections[name] = {
        url: wsUrl,
        state: 1,
        ws: null
    };
    this.endpoint.query = null;
    wsConnect(this, name, wsUrl);
    return this;
};
SkyAPIClient.prototype.provide = SkyAPIClient.prototype.provideService;

function cleanup(client, name) {
    delete client.connections[name];
    if (Object.keys(client.connections).length === 0) {
        clearInterval(client.interval);
        client.interval = null;
    }
}

function close(ws) {
    //remove all listeners first so we don't trigger 'close'
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN) {
        ws.close();
    } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
    }
}

SkyAPIClient.prototype.stopService = function(name) {
    Log.info('Removing provided SkyAPI service', {name: name});
    if (!this.connections.hasOwnProperty(name)) {
        return;
    }
    if (this.connections[name].ws) {
        close(this.connections[name].ws);
    }
    cleanup(this, name);
    this.emit('stopped', name);
};
SkyAPIClient.prototype.stop = SkyAPIClient.prototype.stopService;

SkyAPIClient.prototype.connected = function(name) {
    if (!this.connections.hasOwnProperty(name)) {
        return false;
    }
    return this.connections[name].state === 2;
};

SkyAPIClient.prototype.ping = function() {
    var foundConnection = false,
        name;
    for (name in this.connections) {
        if (!this.connections.hasOwnProperty(name) || !this.connections[name].ws) {
            continue;
        }
        try {
            this.connections[name].ws.ping();
            foundConnection = true;
        } catch (e) {
            Log.error('SkyAPI ping failed', {error: e, service: name});
            reconnect(this, name);
        }
    }
    if (!foundConnection) {
        clearInterval(this.interval);
        this.interval = null;
    }
    return this;
};

SkyAPIClient.prototype._registerWS = function(ws, name) {
    if (!this.connections.hasOwnProperty(name)) {
        //it must've been removed...
        return;
    }
    this.connections[name].ws = ws;
};

SkyAPIClient.prototype._onWSOpen = function(name) {
    if (!this.connections.hasOwnProperty(name)) {
        //it must've been removed...
        return;
    }
    Log.debug('SkyAPI connection open', {service: name});
    //add an interval if there isn't already one added
    if (this.interval === null) {
        this.interval = setInterval(this.ping.bind(this), this.options.pingInterval);
        this.interval.unref();
    }
    this.connections[name].state = 2;
    this.emit('providing', name);
};

function reconnect(client, name) {
    if (!client.connections.hasOwnProperty(name)) {
        //it must've been removed...
        return;
    }
    if (!client.options.reconnect) {
        Log.info('SkyAPI connection not reconnecting', {service: name});
        client.stopService(name);
        return;
    }
    close(client.connections[name].ws);
    client.connections[name].state = 0;
    //try to reconnect in 3 seconds
    setTimeout(function() {
        //if it doesn't exist anymore on connections than it was stopped
        //if there already is a state then something is connecting
        if (client.connections.hasOwnProperty(name) && client.connections[name].state === 0) {
            client.connections[name].state = 1;
            wsConnect(client, name, client.connections[name].url);
        }
    }, client.options.reconnectDelay);
}

SkyAPIClient.prototype._onWSClose = function(name) {
    Log.info('SkyAPI connection closed', {service: name});
    reconnect(this, name);
};

SkyAPIClient.prototype._onWSError = function(name, error) {
    Log.error('SkyAPI connection error', {service: name, error: error});
    reconnect(this, name);
};

module.exports = SkyAPIClient;
