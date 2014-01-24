'use strict';

var coap = require('h5.coap');
var options = {
  ackTimeout: 1000,
  maxRetransmit: 3
};
var client = new coap.Client(options);

client.on('error', function(err)
{
  console.log('[coap#error]');
  console.log(err.stack);
});
client.on('transaction timeout', function(req)
{
  console.log('[coap#transaction timeout]');
  console.log(req.toPrettyString());
});
client.on('exchange timeout', function(req)
{
  console.log('[coap#exchange timeout]');
  console.log(req.toPrettyString());
});
client.on('message sent', function(message, retries)
{
  console.log('[coap#message sent]');

  if (retries > 0)
  {
    console.log(
      "Retransmission of %s (%d of %d)",
      message.getTransactionKey(),
      retries,
      options.maxRetransmit || 4
    );
  }
  else
  {
    console.log(message.toPrettyString());
  }
});
client.on('message received', function(message)
{
  console.log('[coap#message received]');
  console.log(message.toPrettyString());
});

var devscanRegExp = /\[([0-9a-f:]+)\]via\[([0-9a-f:]+)\]/g;
var macFromIpRegExp = /^[0-9a-f]{4}:[0-9a-f]{4}:[0-9a-f]{4}:[0-9a-f]{4}:([0-9a-f]{2})([0-9a-f]{2}):([0-9a-f]{2})[0-9a-f]{2}:[0-9a-f]{2}([0-9a-f]{2}):([0-9a-f]{2})([0-9a-f]{2})$/;

var complete;
var scansInProgress;
var scanQueue;
var macToIpMap;
var macToIdMap;
var nodes;
var links;
var devscanResults;
var coordinatorIp;
var coordinatorMac;

module.exports = function devscan(ip, done)
{
  complete = done;
  scansInProgress = 0;
  scanQueue = [];
  macToIpMap = {};
  macToIdMap = {};
  devscanResults = {};
  coordinatorIp = expandIpv6(ip);
  coordinatorMac = extractMacFromIpv6(ip);

  scanQueue.push(expandIpv6(coordinatorIp));

  setImmediate(execNextDevscan);
};

function execNextDevscan()
{
  if (scanQueue.length === 0 && scansInProgress === 0)
  {
    return setImmediate(analyzeDevscanResults);
  }

  var ip = expandIpv6(scanQueue.shift());

  if (typeof devscanResults[ip] !== 'undefined')
  {
    return setImmediate(execNextDevscan);
  }

  devscanResults[ip] = null;

  execDevscanRequest(ip);
}

function execDevscanRequest(ip)
{
  console.log(">>> Scanning [%s]...", ip);

  ++scansInProgress;

  var req = client.get('coap://[' + ip + ']/devscan', {

  });

  req.on('error', function(err)
  {
    console.log(">>> Failed to scan [%s]: %s", ip, err.message);

    --scansInProgress;

    setImmediate(execNextDevscan);
  });

  req.on('timeout', function()
  {
    console.log(">>> Failed to scan [%s]: CoAP timeout", ip);

    --scansInProgress;

    setImmediate(execNextDevscan);
  });

  req.on('response', function(res)
  {
    --scansInProgress;

    if (res.isSuccess())
    {
      var payload = res.getPayload().toString();

      console.log(">>> Scanned [%s]:", ip);
      console.log(payload);

      devscanResults[ip] = parseDevscanResults(payload);
    }
    else
    {
      console.log(">>> Failed to scan [%s]:", ip);
      console.log(res.toPrettyString());
    }

    setImmediate(execNextDevscan);
  });
}

function parseDevscanResults(payload)
{
  var devscanResult = {};

  if (payload.length === 0)
  {
    return devscanResult;
  }

  var match;

  while ((match = devscanRegExp.exec(payload)) !== null)
  {
    var dstIp = expandIpv6(match[1]);
    var hopIp = expandIpv6(match[2]);
    var dstMac = extractMacFromIpv6(dstIp);
    var hopMac = extractMacFromIpv6(hopIp);

    macToIpMap[dstMac] = dstIp;

    if (dstMac === hopMac)
    {
      devscanResult[dstMac] = null;
    }
    else
    {
      devscanResult[dstMac] = hopMac;
    }

    scanQueue.push(dstIp);
  }

  return devscanResult;
}

function analyzeDevscanResults()
{
  nodes = [];
  links = [];

  var coordinatorId = getNodeId(coordinatorIp, coordinatorMac);
  var coordinatorDevscan = devscanResults[coordinatorIp] || {};

  Object.keys(coordinatorDevscan).forEach(function(dstMac)
  {
    var dstIp = macToIpMap[dstMac];
    var dstId = getNodeId(dstIp, dstMac);
    var hopMac = coordinatorDevscan[dstMac];
    var hopId;

    if (hopMac === null)
    {
      hopId = coordinatorId;
    }
    else
    {
      hopId = findLastHopId(dstMac, hopMac);
    }

    if (hopId !== null)
    {
      links.push({
        source: dstId,
        target: hopId
      });
    }
  });

  complete({
    nodes: nodes,
    links: links
  });

  complete = null;
  scansInProgress = -1;
  scanQueue = null;
  macToIpMap = null;
  macToIdMap = null;
  nodes = null;
  links = null;
  devscanResults = null;
  coordinatorIp = null;
  coordinatorMac = null;
}

function getNodeId(ip, mac)
{
  if (mac in macToIdMap)
  {
    return macToIdMap[mac];
  }

  var id = ip.replace(/:/g, '');

  macToIdMap[mac] = id;

  nodes.push({
    id: id,
    ip: ip,
    mac: mac,
    type: 'controller'
  });

  return id;
}

function findLastHopId(dstMac, hopMac)
{
  var hopIp = macToIpMap[hopMac];

  if (typeof hopIp === 'undefined')
  {
    console.log(">>> hopIp undefined for dstMac=%s hopMac=%s", dstMac, hopMac);

    return null;
  }

  var hopId = getNodeId(hopIp, hopMac);
  var hopDevscan = devscanResults[hopIp];

  if (typeof hopDevscan === 'undefined' || hopDevscan === null)
  {
    return hopId;
  }

  var nextHopMac = hopDevscan[dstMac];

  if (typeof nextHopMac === 'undefined' || nextHopMac === null)
  {
    return hopId;
  }

  return findLastHopId(dstMac, nextHopMac);
}

/**
 * @see http://forrst.com/posts/JS_Expand_Abbreviated_IPv6_Addresses-1OR
 */
function expandIpv6(address)
{
  if (typeof address !== 'string')
  {
    return null;
  }

  if (address.length === 39)
  {
    return address;
  }

  var validGroupCount = 8;
  var validGroupSize = 4;
  var fullAddress;
  var i;
  var l;

  if (address.indexOf('::') === -1)
  {
    fullAddress = address;
  }
  else
  {
    var sides = address.split('::');
    var groupsPresent = 0;

    for (i = 0, l = sides.length; i < l; ++i)
    {
      groupsPresent += sides[i].split(':').length;
    }

    fullAddress = sides[0] + ':';

    for (i = 0, l = validGroupCount - groupsPresent; i < l; ++i)
    {
      fullAddress += '0000:';
    }

    fullAddress += sides[1];
  }

  var groups = fullAddress.split(':');

  if (groups.length !== validGroupCount)
  {
    return null;
  }

  var expandedAddress = '';
  var lastGroupIndex = validGroupCount - 1;

  for (i = 0; i < validGroupCount; ++i)
  {
    while (groups[i].length < validGroupSize)
    {
      groups[i] = '0' + groups[i];
    }

    expandedAddress += groups[i];

    if (i !== lastGroupIndex)
    {
      expandedAddress += ':';
    }
  }

  return expandedAddress.toLowerCase();
}

function extractMacFromIpv6(ip)
{
  ip = expandIpv6(ip);

  if (ip === null)
  {
    return null;
  }

  var parts = ip.match(macFromIpRegExp);

  parts.shift();

  parts[0] = (parseInt(parts[0], 16) ^ 2).toString(16);

  if (parts[0].length === 1)
  {
    parts[0] = '0' + parts[0];
  }

  return parts.join(':');
}
