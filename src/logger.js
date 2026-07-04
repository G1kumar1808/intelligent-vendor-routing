const MAX_LOGS = 500;

const requestLogs = [];
const routingLogs = [];

function logRequest(entry) {
  requestLogs.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (requestLogs.length > MAX_LOGS) requestLogs.pop();
}

function logRouting(entry) {
  routingLogs.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (routingLogs.length > MAX_LOGS) routingLogs.pop();
}

function getLogs({ limit = 50 } = {}) {
  return {
    routingDecisions: routingLogs.slice(0, limit),
    requests: requestLogs.slice(0, limit)
  };
}

module.exports = { logRequest, logRouting, getLogs };
