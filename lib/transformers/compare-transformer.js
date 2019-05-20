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

    // Setup an array of functions to be called.

    // Setup basic meta tag checks
    const basicMetaNameChecks = [
      "description",
      "content-language",
      "dcterms.coverage",
      "dcterms.subject",
      "dcterms.isPartOf",
      "dcterms.issued",
      "english-linking-policy",
      "espanol-linking-policy",
      //dcterms.type is special,
      "twitter:card"
    ].map(metaName => this.webpageCompareMetatag.bind(this, 'name', metaName));

    const basicMetaPropChecks = [
      "og:title",
      "og:description",
      "og:type",
      "og:site_name",
      "og:url",
      "og:image"
      // og:image is special,
    ].map(metaName => this.webpageCompareMetatag.bind(this, 'property', metaName));

    const checks = [
      this.webpageCompareTitle,
      ...basicMetaNameChecks,
      ...basicMetaPropChecks
    ];

    // Apply the functions to the docs and get the resulting errors.
    const testResults = checks.reduce(
      (errsToDate, checkFn) => {
        const errs = checkFn(sourceDoc, destinationDoc);
        return [
          ...errsToDate,
          ...errs
        ];
      }, []
    );

    // Setup the return.
    const rtnObj = {
      path: data.path,
      resourceType: 'WEBPAGE',
      errs: testResults
    };

    debugger;
    return rtnObj;
  }

  webpageCompareTitle(sourceDoc, destinationDoc) {
    const sourceTitle = sourceDoc.window.document.title;
    const destTitle = destinationDoc.window.document.title;
    if (sourceTitle !== destTitle) {
      return [{
        check: "WEBPAGE_COMPARE_TITLE",
        source: sourceTitle,
        destination: destTitle
      }];
    } else {
      return [];
    }
  }

  /**
   * Compares a metatag between two JSDom objects
   * @param {String} attr The attribute name (e.g. 'name' or 'prop')
   * @param {String} name The value of the attr
   * @param {*} sourceDoc The source doc
   * @param {*} destinationDoc The destination document
   */
  webpageCompareMetatag(attr, name, sourceDoc, destinationDoc) {
    const sourceElem = sourceDoc.window.document
                  .head.querySelector(`[${attr}~="${name}"][content]`);
    const sourceData = sourceElem ? sourceElem.content : "VALUE_NOT_FOUND";

    const destinationElem = destinationDoc.window.document
                  .head.querySelector(`[${attr}~="${name}"][content]`);
    const destinationData = destinationElem ? destinationElem.content : "VALUE_NOT_FOUND";

    if (sourceData !== destinationData) {
      return [{
        check: "WEBPAGE_COMPARE_META_" + name,
        source: sourceData,
        destination: destinationData
      }];
    } else {
      return [];
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
