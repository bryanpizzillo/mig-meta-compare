const Sitemapper      = require('sitemapper');
const { URL }         = require('url');

const {
  AbstractRecordSource
} = require('loader-pipeline');

/**
 * This class implements a Source that fetches a list of URLs
 * from a sitemap.
 */
class SitemapSource extends AbstractRecordSource {

  /**
   * Creates a new instance of a GithubResourceSource
   * @param {logger} logger An instance of a logger.
   * @param {Object} sitemap A Sitemapper sitemap.
   * @param {Object} config A configuration object
   * @param {Array} config.urlFilters An array of regexes to filter out urls.
   */
  constructor(logger, sitemap, {
    urlFilters = []
  } = {}) {
    super(logger);

    this.sitemap = sitemap;
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
    // Get sitemap and return server relative URLs
    const urls = (await this.sitemap.fetch()).sites
                  .map(url => new URL(url).pathname)
                  .filter(url => {
                    for (let i=0; i < this.urlFilters.length; i++) {
                      if (this.urlFilters[i].test(url)) { return false; }
                    }
                    return true;
                  });
    return urls;
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
   * @param {string} config.sitemapUrl A URL to the sitemap.
   */
  static ValidateConfig(config) {
    let errors = [];

    if (!config.sitemapUrl) {
      errors.push(new Error("You must supply a sitemap URL"));
    }

    return errors;
  }

  /**
   * A static helper function to get a configured source instance
   * @param {Object} logger the logger to use
   * @param {Object} config configuration parameters to use for this instance. See GithubResourceSource constructor.
   * @param {string} config.sitemapUrl A URL to the sitemap.
   * @param {int} config.timeout Timeout in milliseconds (Default: 120000).
   */
  static async GetInstance(logger, {
    sitemapUrl = false,
    timeout = 120000,
    urlFilters = []
  } = {}) {
    if (!sitemapUrl) {
      throw new Error("Sitemap URL needs to be supplied.");
    }

    const sitemap = new Sitemapper({
      url: sitemapUrl,
      timeout: timeout
    });

    return new SitemapSource(logger, sitemap, {
      urlFilters
    });
  }

}

module.exports = SitemapSource;
