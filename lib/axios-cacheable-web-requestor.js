const fs                              = require('fs');
const path                            = require('path');
const util                            = require('util');
const { URL }                         = require('url');
const AbstractCacheableWebRequestor   = require('./abstract-cacheable-web-requestor');

const statAsync  = util.promisify(fs.stat);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);
const timeout = util.promisify(setTimeout);

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const NETWORK_METHODS = Object.freeze({
  "GET": 1,
  "HEAD": 2
});

/**
 * A class which can be used for web requests that will cache requests
 * for a period of time.
 */
class AxiosCacheableWebRequestor extends AbstractCacheableWebRequestor {

  /**
   * Create a new instance of the AxiosCacheableWebRequestor
   *
   * @param {Logger} logger a logger for logging
   * @param {Object} axclient an Axios client
   * @param {Object} config a configuration object
   * @param {int} config.cacheDuration the length to cache items
   * @param {int} config.cachePath the folder to cache items in
   */
  constructor(logger, axclient, {
    cacheDuration = TWENTY_FOUR_HOURS,
    cachePath = path.join(__dirname, "../html-cache")
  } = {}) {
    super(logger);

    this.ioQueueMaxHandles = 50; //The maximum open read & write file handles. We wont worry about stat handles for now
    this.ioQueueOpenHandles = 0;
    this.ioQueueHandleWait = 50;

    this.instrumenting = false;
    this.stats = {
        pendingRequests: 0,
        pendingStats: 0,
        pendingReads: 0,
        pendingWrites: 0
    }

    this.cacheFolderPath = cachePath;
    this.axclient = axclient;
    this.cacheDuration = cacheDuration;
  }

  /**
   * Updates an IO statistic.
   *
   * @param {String} statType The type of IO
   * @param {String} op Operation Increment ("+") or decrement ("-")
   */
  updateStats(statType, op) {
    if (!this.instrumenting) {
        return;
    }

    if (op === '+') {
        this.stats['pending' + statType]++;
    } else if (op === '-') {
        this.stats['pending' + statType]--;
    } else {
        throw new Error("Unknown stat update operand")
    }
    this.printStats(statType + op);
  }

  /**
   * Prints IO Statistics, if instrumenting is enabled.
   * @param {String} prefix Label consisting of IO type and operation
   */
  printStats(prefix) {
      if (!this.instrumenting)
          return;
      this.logger.debug(`PageFetcher:\t\t${prefix}: Stats: ${this.stats.pendingStats}, Reads: ${this.stats.pendingReads}, Writes: ${this.stats.pendingWrites}, Net: ${this.stats.pendingRequests}`);
  }

  /**
   * Passthrough function for asyncStats to handle IO throttling
   * (determine if a file exists or not)
   * @param {*} filePath The file to stat
   */
  async instStat(filePath) {
    let stat;
    try {
        this.updateStats("Stats", "+");
        stat = await statAsync(filePath);
        this.updateStats("Stats", "-");
    } catch (err) {
        this.updateStats("Stats", "-");
        throw err;
    }
    return stat;
  }

  /**
   * Passthrough function for reading a file to hanlde IO throttling.
   *
   * @param {String} filePath File to read
   * @param {String} enc Encoding type
   */
  async instReadFile(filePath, enc) {
    let content;
    try {
        this.updateStats("Reads", "+");
        content = await this.queuedFileRead(filePath, enc)
        this.updateStats("Reads", "-");
    } catch (err) {
        this.updateStats("Reads", "-");
        throw err;
    }
    return content;
  }

  /**
   * Passthrough function for writing a file to handle IO throttling.
   *
   * @param {string} filePath File to write
   * @param {String} pageContent The file contents
   */
  async instWriteFile(filePath, pageContent) {
    try {
        this.updateStats("Writes", "+");
        await this.queuedFileWrite(filePath, pageContent);
        this.updateStats("Writes", "-");
    } catch (err) {
        this.updateStats("Writes", "-");
        throw err;
    }
  }

  /**
   * Passthrough for network requests to throttle IO
   *
   * @param {String} url The URL to fetch
   * @param {NETWORK_METHODS} method The HTTP method (Only Get & Head supported)
   */
  async instNetReq(url, method) {
    let res;
    try {
        this.updateStats("Requests", "+");
        switch (method) {
          case NETWORK_METHODS.GET:
            res = await this.axclient.get(url);
            break;
          case NETWORK_METHODS.HEAD:
            res = await this.axclient.head(url);
            break;
          default:
            throw new Error(`Unknown Method ${method} for ${url}`);
        }
        this.updateStats("Requests", "-");
    } catch (err) {
        this.updateStats("Requests", "-");
        throw err;
    }
    return res;
  }

  /**
   * Queue a file for writing.
   *
   * @param {string} filePath File to write
   * @param {String} pageContent The file contents
   */
  async queuedFileWrite(filePath, pageContent) {

    if (this.ioQueueOpenHandles <= this.ioQueueMaxHandles) {
        try {
            this.ioQueueOpenHandles++;
            await writeFileAsync(filePath, pageContent);
            this.ioQueueOpenHandles--;
        } catch (err) {
            this.ioQueueOpenHandles--;
            throw err;
        }
    } else {
        await timeout(this.ioQueueHandleWait); //Wait if a space opens
        await this.queuedFileWrite(filePath, pageContent);
    }
  }

  /**
   * Queue a file for reading
   *
   * @param {String} filePath File to read
   * @param {String} enc Encoding type
   */
  async queuedFileRead(filePath, enc) {

      if (this.ioQueueOpenHandles <= this.ioQueueMaxHandles) {
          try {
              this.ioQueueOpenHandles++;
              const content = await readFileAsync(filePath, enc);
              this.ioQueueOpenHandles--;
              return content;
          } catch (err) {
              this.ioQueueOpenHandles--;
              throw err;
          }
      } else {
          await timeout(this.ioQueueHandleWait); //Wait if a space opens
          return await this.queuedFileRead(filePath, enc);
      }
  }

  /**
   * Gets a file path for a URL
   * @param {*} url the url to get the path for
   * @param {NETWORK_METHODS} method the HTTP method to use
   */
  getPathForUrl(url, method) {

    const urlObj = new URL(url);

    const basePath = path.join(
      this.cacheFolderPath,
      urlObj.path
    );

    switch (method) {
      case NETWORK_METHODS.GET:
        return path.join(basePath, `${urlObj.hostname}.html`);
      case NETWORK_METHODS.HEAD:
        return path.join(basePath, `${urlObj.hostname}.json`);
      default:
        throw new Error(`Unknown method ${method} for ${url}`);
    }
  }

  /**
   * Checks the cache for a url before fetching
   * @param {string} url The URL to fetch
   * @param {NETWORK_METHODS} method The HTTP method for the request
   * @returns {string|object|undefined} The HTML contents if the page was in the cache and
   * no more than 24 hours old. The headers if the same. Undefined if not found or old.
   */
  async getFromCache(url, method) {

    const filePath = this.getPathForUrl(url, method);

    let stat;

    try {
        stat = await this.instStat(filePath);
    } catch (err) {

        //File does not exist
        if (err.code == 'ENOENT') {
            //this.logger.debug(`${url} not found in cache`);
            return undefined;
        } else {
            //Something went wrong, so bail
            this.logger.error(`Could not get cache entry for ${url}`)
            throw err;
        }
    }

    if ((Date.now() - stat.mtime) < TWENTY_FOUR_HOURS) {
      //this.logger.debug(`Reading ${url} from cache`);
      //Read file
      return await this.instReadFile(filePath, 'utf8');
    } else {
      //Too old, need to refetch
      //this.logger.debug(`${url} expired in cache`);
      return undefined;
    }
  }

  /**
   * Fetches a single URL from the server
   * @param {String} url the URL to fetch
   * @param {NETWORK_METHODS} method The HTTP method for the fetch
   */
  async fetchUrl(url, method) {

    // This needs to be different for the methods
    let res;
    try {
      //this.logger.debug(`PageFetcher:\t\tFetching ${url}`);
      res = await this.instNetReq(url, method);
      this.logger.debug(`PageFetcher:\t\tCompleted Fetching ${url}`);
    } catch (err) {

      if (err.response && err.response.status) {
        //throw new Error(`Bad status, ${res.status} , while fetching url ${url}`)
        this.logger.error(`Bad status, ${err.response.status} , while fetching url ${url} via ${method}`)
        return undefined;
      }

      if (err.errno && err.code === 'ECONNRESET') {
        this.logger.debug(`PageFetcher:\t\tRetrying fetch of ${url} via ${method}`);
        await timeout(10000); //Wait 10 seconds before trying again
        return await this.fetchUrl(url);
      }

      this.logger.error(`Could not fetch url, ${url} using ${method}.`)
      throw err;
    }

    if (res.status !== 200) {
      //throw new Error(`Bad status, ${res.status} , while fetching url ${url}`)
      this.logger.error(`Bad status, ${res.status} , while fetching url ${url} via ${method}`)
      return;
    }

    //If it is not HTML, then we need to move on.
    if (res.headers['content-type'] !== 'text/html; charset=utf-8') {
      return "||FILEDATA||"; //A marker to identify this was a file.
    }

    return res.data;
  }

  /**
   * Saves the contents of a page to the file system
   * @param {String} url the URL to fetch
   * @param {NETWORK_METHODS} method the method for the request
   * @param {*} content
   */
  async saveToCache(url, method, pageContent) {
    const filePath = this.getPathForUrl(url);

    try {
        await this.instWriteFile(filePath, pageContent);
    } catch(err) {
        this.logger.error(`Could not save ${url} to ${filePath}`)
        throw err;
    }

  }


  /**
   * Requests the headers for a URL
   * @param {string} url The URL
   */
  async getHeaders(url) {
    if (!url) {
      throw new Error("URL must be provided.");
    }

  }

  /**
   * Gets the content of a URL
   * @param {*} url
   */
  async getContents(url) {
    if (!url) {
      throw new Error("URL must be provided.");
    }

  }

}

module.exports = AxiosCacheableWebRequestor;
