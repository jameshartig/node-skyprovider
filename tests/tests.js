var url = require('url'),
    WebSocketServer = require('ws').Server,
    SkyProvider = require('../skyProvider.js'),
    currentServices = [],
    serverPort = 14053,
    provider = new SkyProvider('ws://127.0.0.1:' + serverPort + '/provide'),
    server;

//from https://github.com/caolan/nodeunit/issues/244
process.on('uncaughtException', function(err) {
    console.error(err.stack);
    process.exit(1);
});

function verifyProvide(name, port, priority, weight) {
    if (priority == null) {
        priority = 1;
    }
    if (weight == null) {
        weight = 100;
    }
    for (var i = 0; i < currentServices.length; i++) {
        if (currentServices[i].name !== name ||
            currentServices[i].port !== port ||
            currentServices[i].priority !== priority ||
            currentServices[i].weight !== weight) {
            continue;
        }
        return true;
    }
    return false;
}

exports.startWSServer = function(test) {
    server = new WebSocketServer({
        port: serverPort,
        host: '127.0.0.1',
        path: '/provide'
    }, function() {
        test.done();
    });

    var _handleUpgrade = server.handleUpgrade;
    //stop an "upgrade" to websockets if its invalid
    server.handleUpgrade = function(req, socket, upgradeHead, cb) {
        var u = url.parse(req.url, true);
        if (u.pathname !== '/provide') {
            console.error('Invalid path', u.pathname);
            socket.destroy();
            return;
        }
        //port must be numeric and service must be defined and not empty
        if (isNaN(parseInt(u.query.port, 10)) || !u.query.service) {
            console.error('Invalid port/service', u.query);
            socket.destroy();
            return;
        }
        //priority must be numeric
        if (u.query.priority != null && isNaN(parseInt(u.query.priority, 10))) {
            console.error('Invalid priority', u.query);
            socket.destroy();
            return;
        }
        //priority must be numeric
        if (u.query.weight != null && isNaN(parseInt(u.query.weight, 10))) {
            console.error('Invalid weight', u.query);
            socket.destroy();
            return;
        }
        //passes validation
        return _handleUpgrade.call(this, req, socket, upgradeHead, cb);
    };

    server.on('connection', function(ws) {
        var q = url.parse(ws.upgradeReq.url, true).query,
            service = {
                name: q.service,
                port: +q.port,
                priority: q.priority == null ? 1 : +q.priority,
                weight: q.weight == null ? 100 : +q.weight
            };
        currentServices.push(service);
        ws.once('close', function() {
            var i = currentServices.indexOf(service);
            if (i > -1) {
                currentServices.splice(i, 1);
            }
        });
    });
};

exports.provideNoPortThrows = function(test) {
    test.expect(1);
    test.throws(function() {
        provider.provideService('test');
    });
    test.done();
};

exports.provide = function(test) {
    test.expect(1);
    provider.once('providing', function() {
        test.ok(verifyProvide('test', 8000));
        test.done();
    });
    provider.provideService('test', 8000);
};

exports.connected = function(test) {
    test.ok(provider.connected('test'));
    //make sure the ping timer was started
    test.notEqual(provider.interval, null);
    test.done();
};

//todo: test to make sure pinging works

exports.stop = function(test) {
    test.expect(2);
    provider.once('stopped', function() {
        //we annoyingly have to wait for the server to receive the close and emit 'close' on the connection
        setTimeout(function() {
            test.ok(!verifyProvide('test', 8000));
            //make sure the ping timer was stopped
            test.ok(provider.interval === null);
            test.done();
        }, 100);
    });
    provider.stopService('test');
};

//unfortunately .unref() doesn't work on the websocket server
exports.stopWSServer = function(test) {
    if (server) {
        server.close();
    }
    test.done();
};
