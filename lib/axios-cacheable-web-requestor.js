const AbstractCacheableWebRequestor      = require('./abstract-cacheable-web-requestor');

class AxiosCacheableWebRequestor extends AbstractCacheableWebRequestor {

  constructor(logger) {
    super(logger);
  }
}

module.exports = AxiosCacheableWebRequestor;
