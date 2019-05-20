const axios                         = require('axios');
const https                         = require('https');
const fs                            = require('fs');
const path                          = require('path');
const util                          = require('util');
const { HttpsAgent }                = require('agentkeepalive');
const { AbstractRecordTransformer } = require('loader-pipeline');

const statAsync  = util.promisify(fs.stat);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);
const timeout = util.promisify(setTimeout);

const NETWORK_METHODS = Object.freeze({
  "GET": 1,
  "HEAD": 2
});

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
   * @param {Object} axclient Axios client for making HTTP(s) requests
   * @param {Object} config configuration parameters to use for this instance.
   * @param {string} config.sourceHost The migration source host
   * @param {string} config.destinationHost The migration destination host
   */
  constructor(logger, axclient, {
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

    this.axclient = axclient;

    this.cacheFolderPath = path.join(__dirname, "../../html-cache");
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
   * Transforms the resource
   * @param {Object} data the object to be transformed
   * @returns the transformed object
   */
  async transform(data) {

    // Fetch A
    // Fetch B
    // Compare
    // Return an array of issues

    // Return an object with all the information for a comparison.
    return {
      mimeType: undefined,
      sourceHeaders: undefined,
      destinationHeaders: undefined,
      sourceContent: undefined,
      destinationContent: undefined
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
