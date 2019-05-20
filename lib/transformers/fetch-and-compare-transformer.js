const axios                         = require('axios');
const { HttpsAgent }                = require('agentkeepalive');
const { AbstractRecordTransformer } = require('loader-pipeline');
const AbstractCacheableWebRequestor = require('../abstract-cacheable-web-requestor');
const AxiosCacheableWebRequestor    = require('../axios-cacheable-web-requestor');

/**
 * This class implements a Record transformer that fetches a page
 * from two web servers and compares the pages, yeilding an array
 * of issues for that url.
 */
class FetchAndCompareTransformer extends AbstractRecordTransformer {

  /**
   * Creates a new instance of a FetchAndCompareTransformer
   *
   * @param {logger} logger An instance of a logger.
   * @param {AbstractCacheableWebRequestor} requestor Axios client for making HTTP(s) requests
   * @param {Object} config configuration parameters to use for this instance.
   * @param {string} config.sourceHost The migration source host
   * @param {string} config.destinationHost The migration destination host
   */
  constructor(logger, requestor, {
    sourceHost = false,
    destinationHost = false
  }) {
    super(logger);

    if (!sourceHost) {
      throw new Error("You must supply a sourceHost");
    }
    if (!destinationHost) {
      throw new Error("You must supply a destinationHost");
    }

    this.sourceHost = sourceHost;
    this.destinationHost = destinationHost;

    this.requestor = requestor;
  }


  /**
   * Transforms the resource
   * @param {Object} data the object to be transformed
   * @returns the transformed object
   */
  async transform(path) {

    const sourceUrl = this.sourceHost + path;
    const destinationUrl = this.destinationHost + path;

    let sourceHeaders;
    let destinationHeaders;

    try {
      sourceHeaders = await this.requestor.getHeaders(sourceUrl);
    } catch (err) {

    }

    try {
      destinationHeaders = await this.requestor.getHeaders(destinationUrl);
    } catch (err) {

    }



    // Compare
    // Return an array of issues

    // Return an object with all the information for a comparison.
    return {
      resourceType: undefined, // File or Webpage
      status: undefined, // Source failure, destination failure
      sourceHeaders: undefined,
      destinationHeaders: undefined,
      sourceContent: undefined,
      destinationContent: undefined,

    }
  }

  /**
   * Called before any resources are transformed -- load mappers and anything else here.
   */
  async begin() {
      return;
  }

  /**
   * Method called after all resources have been transformed
   */
  async end() {
      return; //I have nothing to do here...
  }

  /**
   * Called upon a fatal loading error. Use this to clean up any items created on startup
   */
  async abort() {
      return;
  }

  /**
   * A static method to validate a configuration object against this module type's schema
   * @param {Object} config configuration parameters to use for this instance.
   * @param {string} config.sourceHost The migration source host
   * @param {string} config.destinationHost The migration destination host
   */
  static ValidateConfig(config) {
    let errors = [];

    if (!config.sourceHost) {
      errors.push(new Error("You must supply a sourceHost"));
    }
    if (!config.destinationHost) {
      errors.push(new Error("You must supply a destinatonHost"));
    }

    return errors;
  }

  /**
   * A static helper function to get a configured source instance
   * @param {Object} logger the logger to use
   * @param {Object} config configuration parameters to use for this instance.
   */
  static async GetInstance(logger, config) {
    if (!config) {
      throw new Error("Config must be supplied");
    }

    //TODO: Find a better way to manage the agent so there can be one agent per
    //application.  (and thus one pool of sockets)
    const agent = new HttpsAgent({
      maxSockets: 40
    });

    //Get instance of axios with our custom https agent
    const axiosInstance = axios.create({
      httpsAgent: agent
    });

    return new FetchAndCompareTransformer(logger, axiosInstance, config);
  }
}

module.exports = FetchAndCompareTransformer;
