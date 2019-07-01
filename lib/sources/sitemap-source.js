const fs              = require('fs');
const util            = require('util');
const xml2js          = require('xml2js-es6-promise');
const { URL }         = require('url');
const {
  AbstractRecordSource
} = require('loader-pipeline');

const readFileAsync = util.promisify(fs.readFile);

/**
 * This class implements a Source that fetches a list of URLs
 * from a sitemap.
 */
class SitemapSource extends AbstractRecordSource {

  /**
   * Creates a new instance of a GithubResourceSource
   * @param {logger} logger An instance of a logger.
   * @param {Object} config A configuration object
   * @param {string} config.sitemapPath the path to the sitemap.
   * @param {Array} config.urlFilters An array of regexes to filter out urls.
   */
  constructor(logger, {
    sitemapPath = null,
    urlFilters = []
  } = {}) {
    super(logger);

    if (sitemapPath === null) {
      throw new Error("Sitemap path is required.");
    }

    this.sitemapPath = sitemapPath;
    this.urlFilters = urlFilters.map(regex => new RegExp(regex));
  }

  /**
   * Called before any resources are loaded.
   */
  async begin() {
    return;
  }

  /**
   * Get a collection of records from this source
   */
  async getRecords() {

    // Load sitemap file.
    let sitemapFile;

    try {
      sitemapFile = await readFileAsync(this.sitemapPath);
    } catch (err) {
      this.logger.error(`Could not load sitemap file ${this.sitemapPath}`);
      throw err;
    }

    // Parse sitemap file
    let sitemap;

    try {
      sitemap = await xml2js(sitemapFile)
    } catch (err) {
      this.logger.error(`Could not load sitemap`);
      throw err;
    }

    const urls = sitemap.urlset.url
                  .map(entry => new URL(entry.loc[0]).pathname)
                  .filter(url => {
                    for (let i=0; i < this.urlFilters.length; i++) {
                      if (this.urlFilters[i].test(url)) { return false; }
                    }
                    return true;
                  });

                  // TODO: Remove Slice.
    // Limit test records to 5.
    return urls;
    //return urls.slice(0,5);
  }

  /**
   * Method called after all resources have been loaded
   */
  async end() {
    return;
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
   * @param {string} config.sitemapPath A local path to the sitemap.
   */
  static ValidateConfig(config) {
    let errors = [];

    if (!config.sitemapPath) {
      errors.push(new Error("You must supply a sitemap path"));
    }

    return errors;
  }

  /**
   * A static helper function to get a configured source instance
   * @param {Object} logger the logger to use
   * @param {Object} config configuration parameters to use for this instance. See GithubResourceSource constructor.
   * @param {string} config.sitemapPath A local path to the sitemap.
   * @param {Array} config.urlFilters Array of regexes to remove urls from sitemap.
   */
  static async GetInstance(logger, {
    sitemapPath = false,
    urlFilters = []
  } = {}) {
    if (!sitemapPath) {
      throw new Error("Sitemap Path needs to be supplied.");
    }

    return new SitemapSource(logger, {
      sitemapPath,
      urlFilters
    });
  }

}

module.exports = SitemapSource;
