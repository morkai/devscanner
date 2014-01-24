'use strict';

var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io').listen(server, {log: false});
var devscan = require('./devscan');
var coordinatorIp = process.argv[2] || '2222::3';

var scanning = false;
var lastResults = {
  version: Date.now(),
  nodes: [],
  links: []
};

app.use(express.static(__dirname + '/../frontend'));
app.use(express.errorHandler({
  dumpExceptions: true,
  showStack: true
}));

server.listen(1337);

app.get('/', function (req, res)
{
  res.sendfile('frontend/main.html', __dirname + '/../');
});

io.sockets.on('connection', function(socket)
{
  socket.on('getLastResults', function(reply)
  {
    reply(lastResults);
  });

  socket.on('devscan', function(reply)
  {
    if (scanning)
    {
      return reply();
    }

    scanning = true;

    devscan(coordinatorIp, function(results)
    {
      results.version = Date.now();

      scanning = false;
      lastResults = results;

      socket.broadcast.emit('devscan', results);

      reply(results);
    });
  });
});

