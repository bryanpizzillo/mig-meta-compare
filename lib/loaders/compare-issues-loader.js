const { AbstractRecordLoader }  = require('loader-pipeline');

/**
 * This class implements a load that saves the issues found
 * during the comparison.
 */
class CompareIssuesLoader extends AbstractRecordLoader {

  constructor(logger) {
    super(logger);
  }

  /**
   * Store the information about this page comparison.
   *
   * @param {*} pageInfo the report about a page
   */
  async loadRecord(pageInfo) {
    return;
  }

  /**
   * Called before any resources are loaded.
   */
  async begin() {
    return;
  }

  /**
   * Called upon a fatal loading error. Use this to clean up any items created on startup
   */
  async abort() {
    return;
  }

  /**
   * Method called after all resources have been loaded
   */
  async end() {
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

    return new CompareIssuesLoader(logger);
  }
}

module.exports = CompareIssuesLoader;
