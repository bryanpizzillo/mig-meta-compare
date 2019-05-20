const axios                         = require('axios');
const path                          = require('path');
const { HttpsAgent }                = require('agentkeepalive');
const { AbstractRecordTransformer } = require('loader-pipeline');
const AxiosCacheableWebRequestor    = require('../axios-cacheable-web-requestor');

/**
 * This class implements a Record transformer that fetches a page
 * from two web servers and compares the pages, yeilding an array
 * of issues for that url.
 */
class FetchTransformer extends AbstractRecordTransformer {

  /**
   * Creates a new instance of a FetchTransformer
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
  } = {}) {
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
    let errors = [];

    try {
      sourceHeaders = await this.requestor.getHeaders(sourceUrl);
    } catch (err) {
      errors.push(err);
    }

    try {
      destinationHeaders = await this.requestor.getHeaders(destinationUrl);
    } catch (err) {
      errors.push(err);
    }

    if (!sourceHeaders) {
      errors.push(new Error("Source was a non-200 status"));
    }

    if (!destinationHeaders) {
      errors.push(new Error("Destination was a non-200 status"));
    }

    // Error fetching, return failure.
    if (errors.length > 0) {
      return {
        path,
        errorStep: 'FETCH_HEADERS',
        fetchErrors: errors
      };
    }

    // This is a file. (Assume source and dest are same mime type)
    const contentType = sourceHeaders['content-type'];
    if (!contentType || !contentType.startsWith('text/html;')) {
      return {
        path,
        resourceType: 'FILE',
        sourceHeaders,
        destinationHeaders
      };
    }

    let sourceContent;
    let destinationContent;

    try {
      sourceContent = await this.requestor.getContents(sourceUrl);
    } catch (err) {
      errors.push(err);
    }

    try {
      destinationContent = await this.requestor.getContents(destinationUrl);
    } catch (err) {
      errors.push(err);
    }

    // Error fetching, return failure.
    if (errors.length > 0) {
      return {
        path,
        errorStep: 'FETCH_CONTENT',
        fetchErrors: errors
      };
    }

    // Return an object with all the information for a comparison.
    return {
      path,
      resourceType: 'WEBPAGE',
      sourceHeaders,
      destinationHeaders,
      sourceContent,
      destinationContent,
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

    const requestor = new AxiosCacheableWebRequestor(logger, axiosInstance, {
      cachePath: path.join(__dirname, "../../html-cache")
    });


    return new FetchTransformer(logger, requestor, config);
  }
}

module.exports = FetchTransformer;
