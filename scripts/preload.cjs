// Test-only: neutralize the `server-only` guard so service modules can be
// imported in a plain Node/tsx context for integration checks.
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};
