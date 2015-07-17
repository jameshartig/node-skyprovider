# skyprovider #

Advertises a service to skydns via [skyapi](https://github.com/mediocregopher/skyapi). Whatever
`name` you use choose will have `services.[root]` appended to it. If your etcd root was
`example` and you provide'd with name `auth-api` then the SRV record would be under
`auth-api.services.example`.

Once providing has started the library will automatically ping skyapi every 15 seconds. If
disconnected it will automatically try reconnecting every 3 seconds.

### Usage ###

```JS
var SkyProvider = require('skyprovider');

var provider = new SkyProvider('ws://127.0.0.1:8053/provide');
provider.provideService('myservice', 8080);
```

## Methods ##

### SkyProvider(endpoint) ###

`endpoint` is the WebSocket endpoint to contact skyapi over. Must start with `ws://` and
the path should be `/provide`.

### provider.provideService(name, port[, options]) ###

Start advertising that we provide service `name` to skyapi. `options` are sent directory to skyapi
as [GET parameters](https://github.com/mediocregopher/skyapi#usage):
* `priority`: the priority of the service (lower is more preferred)
* `weight`: the weight of the service (higher is more preferred)
* `host`: the IP/hostname to reach the service (defaults to the IP that was used to reach skyapi)

### provider.stopService(name) ###

Stops advertising service `name` to skyapi.

### provider.connected(name) ###

Returns `true`/`false` depending on if `name` is currently being advertised to skyapi. This
will return false if we are disconncted from skyapi or if `provideService` has not been called
for `name`.

## Events ##

SkyProvider implements the EventEmitter class.

### providing ###

`function (name) {}`

Emitted when the `name` service has been successfully advertised to skyapi. 

### stopped ###

`function (name) {}`

Emitted when the `name` service has stopped being advertised to skyapi. 
