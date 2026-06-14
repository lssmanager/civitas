const { requireScope } = require("./auth");

const requireOwner = requireScope("owner:read");

module.exports = {
  requireOwner,
};
