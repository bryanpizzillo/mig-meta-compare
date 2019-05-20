
/**
 * Class used to perform and cache web requests in a
 * throttled way.
 */
class AbstractCacheableWebRequestor {

  /**
   * Creates a new instance of the AbstractPipelineStep
   * @param {object} logger
   */
  constructor(logger) {

    if (this.constructor === AbstractCacheableWebRequestor) {
        throw new TypeError("Cannot construct AbstractCacheableWebRequestor");
    }

    if (this.begin === AbstractCacheableWebRequestor.prototype.getHeaders) {
        throw new TypeError("Must implement abstract method getHeaders");
    }

    if (this.abort === AbstractCacheableWebRequestor.prototype.getContents) {
        throw new TypeError("Must implement abstract method getContents");
    }

    this.logger = logger;
  }

  /**
   * Requests the headers for a URL
   * @param {string} url The URL
   */
  async getHeaders(url) {
    if (!url) {
      throw new Error("URL must be provided.");
    }

    throw new Error("Cannot call abstract method.  Implement getHeaders in derrived class.");
  }

  /**
   * Gets the content of a URL
   * @param {*} url
   */
  async getContents(url) {
    if (!url) {
      throw new Error("URL must be provided.");
    }

    throw new Error("Cannot call abstract method.  Implement getContents in derrived class.");
  }

}

module.exports = AbstractCacheableWebRequestor;
