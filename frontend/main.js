'use strict';

var socket = io.connect('', {
  'transports': ['websocket'],
  'auto connect': true,
  'connect timeout': 2000,
  'reconnect': true,
  'reconnection delay': 100,
  'reconnection limit': 1000,
  'max reconnection attempts': Infinity
});
var scanEl = document.getElementById('scan');
var vis;
var force;
var lastResults = {version: -1, nodes: [], links: []};

socket.on('connect', function()
{
  console.log("Socket connected");

  socket.emit('getLastResults', function(results)
  {
    if (results.version !== lastResults.version)
    {
      lastResults = results;

      updateGraph();
    }

    scan();
  });
});

socket.on('disconnect', function()
{
  console.log("Socket disconnected");

  scanEl.disabled = false;
});

socket.on('devscan', handleScanResult);

scanEl.addEventListener('click', scan);

document.addEventListener('keypress', function(e)
{
  if (e.which === 13 || e.which === 32)
  {
    scan();
  }
});

window.addEventListener('resize', debounce(resizeGraph, 1000 / 60), false);

function scan()
{
  if (scanEl.disabled)
  {
    return;
  }

  console.log("Scanning...");

  scanEl.disabled = true;

  socket.emit('devscan', function(results)
  {
    if (typeof results === 'object')
    {
      handleScanResult(results);
    }
  });
}

function handleScanResult(results)
{
  scanEl.disabled = false;

  if (!results)
  {
    return console.log("Scan failed :(");
  }

  if (results.version === lastResults.version)
  {
    return;
  }

  lastResults = results;
  lastResults.links = lastResults.links
    .map(function(link)
    {
      link.source = getNodeIndexById(link.source);
      link.target = getNodeIndexById(link.target);

      return link;
    })
    .filter(function(link)
    {
      return link.source !== -1 && link.target !== -1;
    });

  console.log("Devscan:", results);

  updateGraph();
}

function getNodeIndexById(id)
{
  for (var i = 0, l = lastResults.nodes.length; i < l; ++i)
  {
    if (lastResults.nodes[i].id === id)
    {
      return i;
    }
  }

  return -1;
}

function updateGraph()
{
  if (!vis)
  {
    var size = getSize();

    setUpVis(size);
    setUpForce(size);
  }

  console.log("Updating graph...");

  restart();
}

function getSize()
{
  return {width: window.innerWidth, height: window.innerHeight};
}

function resizeGraph()
{
  var size = getSize();

  d3.select('#graph svg').attr(size).select('rect').attr(size);

  force.size([size.width, size.height]);
}

function setUpVis(size)
{
  var outerVis = d3.select('#graph').append('svg')
    .attr('width', size.width)
    .attr('height', size.height)
    .attr('pointer-events', 'all')
    .append('g')
    .call(d3.behavior.zoom().on('zoom', zoom));

  outerVis.append('rect')
    .attr('width', size.width)
    .attr('height', size.height)
    .attr('fill', '#f8f8f8');

  vis = outerVis.append('g');

  function zoom()
  {
    vis.attr('transform', 'translate(' + d3.event.translate + ') scale(' + d3.event.scale + ')');
  }
}

function setUpForce(size)
{
  force = d3.layout.force()
    .nodes(lastResults.nodes)
    .links(lastResults.links)
    .gravity(0.05)
    .distance(function(d) { return d.distance || 100; })
    .charge(-500)
    .size([size.width, size.height]);

  force.on('tick', function()
  {
    vis.selectAll('.link')
      .attr('x1', function(d) { return d.source.x; })
      .attr('y1', function(d) { return d.source.y; })
      .attr('x2', function(d) { return d.target.x; })
      .attr('y2', function(d) { return d.target.y; });

    vis.selectAll('.node')
      .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
  });
}

function getNodeClassNames(d)
{
  return 'node ' + d.type;
}

function enterNodes(nodes)
{
  var node = nodes.enter().append('g')
    .attr('class', getNodeClassNames)
    .call(force.drag)
    .on('mousedown', function() { d3.event.stopPropagation(); });

  var symbol = d3.svg.symbol()
    .size(800)
    .type('circle');

  node.append('path')
    .attr('d', symbol);

  node.append('text')
    .attr('x', 20)
    .attr('y', 4)
    .text(function(d) { return d.mac; });
}

function updateNodes(nodes)
{
  nodes.attr('class', getNodeClassNames);

  nodes.selectAll('text')
    .text(function(d) { return d.mac; });
}

function exitNodes(nodes)
{
  nodes.exit().remove();
}

function restart()
{
  restartLinks();
  restartNodes();
  restartForce();
}

function restartLinks(restartForce)
{
  var links = vis.selectAll('.link')
    .data(lastResults.links, function(d) { return d.source + '-' + d.target; });

  links.enter().insert('line', 'g.node')
    .attr('class', 'link')
    .attr('x1', function(d) { return d.source.x; })
    .attr('y1', function(d) { return d.source.y; })
    .attr('x2', function(d) { return d.target.x; })
    .attr('y2', function(d) { return d.target.y; });

  links.exit().remove();

  if (restartForce)
  {
    restartForce();
  }
}

function restartNodes(restartForce)
{
  var nodes = vis.selectAll('g.node')
    .data(lastResults.nodes, function(d) { return d.id; });

  updateNodes(nodes);
  enterNodes(nodes);
  exitNodes(nodes);

  if (restartForce)
  {
    restartForce();
  }
}

function restartForce()
{
  force
    .nodes(lastResults.nodes)
    .links(lastResults.links)
    .start();
}

// http://colingourlay.github.io/presentations/reusable-responsive-charts-with-d3js/#/54
function debounce(fn, wait) {
  var timeout;

  return function () {
    var context = this,              // preserve context
      args = arguments,            // preserve arguments
      later = function () {        // define a function that:
        timeout = null;          // * nulls the timeout (GC)
        fn.apply(context, args); // * calls the original fn
      };

    // (re)set the timer which delays the function call
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
