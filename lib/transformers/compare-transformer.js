const { JSDOM }                     = require('jsdom');
const { AbstractRecordTransformer } = require('loader-pipeline');

/**
 * This class implements a Record transformer that compares a
 * fetched page pages, yeilding an array of issues for that url.
 */
class CompareTransformer extends AbstractRecordTransformer {

  /**
   * Creates a new instance of a FetchTransformer
   *
   * @param {logger} logger An instance of a logger.
   * @param {Object} config configuration parameters to use for this instance.
   */
  constructor(logger) {
    super(logger);
  }

  /**
   * Transforms the resource
   * @param {Object} data the object to be transformed
   * @returns the transformed object
   */
  async transform(data) {
    // Data will be an object that either has Errors, a Webpage or a file.
    if (data['errorStep']) {
      return this.processFetchError(data);
    } else if (data['resourceType'] === 'FILE') {
      return this.compareFileHeaders(data);
    } else if (data['resourceType'] === 'WEBPAGE') {
      return this.compareWebPage(data);
    }
  }

  processFetchError(data) {
    return data;
  }

  compareFileHeaders(data) {
    return data;
  }

  compareWebPage(data) {
    const sourceDoc = new JSDOM(data.sourceContent);
    const destinationDoc = new JSDOM(data.destinationContent);

    //sourceDoc.window.document.title === destinationDoc.window.document.title

    debugger;
    return data;
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
   */
  static ValidateConfig(config) {
    let errors = [];

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

    return new CompareTransformer(logger, config);
  }
}

module.exports = CompareTransformer;
