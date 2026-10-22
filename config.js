// BloodBridge configuration
//
// Leave API_BASE empty to run in DEMO MODE: all data lives in this browser
// (localStorage) and the matching engine runs client-side, so the whole flow
// works with no AWS resources at all.
//
// Once API Gateway is deployed, paste its invoke URL here (no trailing slash),
// e.g. "https://abc123.execute-api.ap-south-1.amazonaws.com"
// and the site switches to the real Lambda/DynamoDB backend.
window.BLOODBRIDGE_CONFIG = {
  API_BASE: ""
};
