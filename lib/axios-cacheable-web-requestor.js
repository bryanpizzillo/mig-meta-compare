const fs                              = require('fs');
const path                            = require('path');
const util                            = require('util');
const { URL }                         = require('url');
const AbstractCacheableWebRequestor   = require('./abstract-cacheable-web-requestor');

const statAsync  = util.promisify(fs.stat);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);
const mkdirAsync = util.promisify(fs.mkdir);
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
    cachePath = false
  } = {}) {
    super(logger);

    if (!cachePath) {
      throw new Error("cachePath must be provided.")
    }

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

    this.cachePath = cachePath;
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
            // Make dir if it does not exist.
            await mkdirAsync(path.dirname(filePath), { recursive: true });
            // Write file.
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
      this.cachePath,
      urlObj.pathname
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
   * @returns {string|undefined} The cached request data.
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

    if ((Date.now() - stat.mtime) < this.cacheDuration) {
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
   * Saves the contents of a page to the file system
   * @param {String} url the URL to fetch
   * @param {NETWORK_METHODS} method the method for the request
   * @param {String} data The data to store
   */
  async saveToCache(url, method, data) {
    const filePath = this.getPathForUrl(url, method);

    try {
        await this.instWriteFile(filePath, data);
    } catch(err) {
        this.logger.error(`Could not save ${url} to ${filePath}`)
        throw err;
    }

  }

  /**
   * Fetches a single URL from the server
   * @param {String} url the URL to fetch
   */
  async fetchUrlContents(url) {

    // This needs to be different for the methods
    let res;
    try {
      //this.logger.debug(`PageFetcher:\t\tFetching ${url}`);
      res = await this.instNetReq(url, NETWORK_METHODS.GET);
      this.logger.debug(`PageFetcher:\t\tCompleted Fetching contents ${url}`);
    } catch (err) {

      if (err.response && err.response.status) {
        //throw new Error(`Bad status, ${res.status} , while fetching url ${url}`)
        this.logger.error(`Bad status, ${err.response.status} , while fetching url contents ${url}`)
        return undefined;
      }

      if (err.errno && err.code === 'ECONNRESET') {
        this.logger.debug(`PageFetcher:\t\tRetrying fetch of contents ${url}`);
        await timeout(10000); //Wait 10 seconds before trying again
        return await this.fetchUrlContents(url);
      }

      this.logger.error(`Could not fetch url, ${url} contents.`)
      throw err;
    }

    if (res.status !== 200) {
      //throw new Error(`Bad status, ${res.status} , while fetching url ${url}`)
      this.logger.error(`Bad status, ${res.status} , while fetching url ${url} contents`)
      return;
    }

    //If it is not HTML, then we need to move on.
    const contentType = res.headers['content-type'];
    if (!contentType || !contentType.startsWith('text/html;')) {
      return "||FILEDATA||"; //A marker to identify this was a file.
    }

    return res.data;
  }

    /**
   * Fetches a single URL from the server
   * @param {String} url the URL to fetch
   */
  async fetchUrlHeaders(url) {

    // This needs to be different for the methods
    let res;
    try {
      //this.logger.debug(`PageFetcher:\t\tFetching ${url}`);
      res = await this.instNetReq(url, NETWORK_METHODS.HEAD);
      this.logger.debug(`PageFetcher:\t\tCompleted Fetching headers ${url}`);
    } catch (err) {

      if (err.response && err.response.status) {
        //throw new Error(`Bad status, ${res.status} , while fetching url ${url}`)
        this.logger.error(`Bad status, ${err.response.status} , while fetching url headers ${url}`)
        return undefined;
      }

      if (err.errno && err.code === 'ECONNRESET') {
        this.logger.debug(`PageFetcher:\t\tRetrying fetch of headers ${url}`);
        await timeout(10000); //Wait 10 seconds before trying again
        return await this.fetchUrlHeaders(url);
      }

      this.logger.error(`Could not fetch url, ${url} using.`)
      throw err;
    }

    if (res.status !== 200) {
      //throw new Error(`Bad status, ${res.status} , while fetching url ${url}`)
      this.logger.error(`Bad status, ${res.status} , while fetching url ${url}`)
      return;
    }

    return res.headers;
  }

  /**
   * Requests the headers for a URL
   * @param {string} url The URL
   */
  async getHeaders(url) {
    if (!url) {
      throw new Error("URL must be provided.");
    }

    let data = await this.getFromCache(url, NETWORK_METHODS.HEAD);

    if (!data) {
      data = await this.fetchUrlHeaders(url);

      if (data) {
        await this.saveToCache(url, NETWORK_METHODS.HEAD, JSON.stringify(data));
      }
    }

    if (!data) {
      return undefined;
    }

    return (typeof data === 'string') ? JSON.parse(data) : data;
  }

  /**
   * Gets the content of a URL
   * @param {*} url
   */
  async getContents(url) {
    if (!url) {
      throw new Error("URL must be provided.");
    }

    let content = await this.getFromCache(url, NETWORK_METHODS.GET);

    if (!content) {
      content = await this.fetchUrlContents(url);

      if (content) {
        await this.saveToCache(url, NETWORK_METHODS.GET, content);
      }
    }

    if (!content) {
      return undefined;
    }

    // COMMENTED OUT FOR DEBUGGING PURPOSES.
    //This was not a real HTML Page, so skip
//    if (content === '||FILEDATA||') {
//      return undefined;
//    }

    return content;
  }

}

module.exports = AxiosCacheableWebRequestor;
