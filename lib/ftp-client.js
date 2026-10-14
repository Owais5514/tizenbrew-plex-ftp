const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');

/**
 * Pure Node.js FTP / FTPS Client
 * Zero external dependencies. Fully handles passive mode, synchronous MLSD/LIST, PWD resolution,
 * and HTTP Range streaming requests.
 */
class SimpleFtpClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      host: options.host || '127.0.0.1',
      port: options.port ? parseInt(options.port, 10) : 21,
      user: options.user || 'anonymous',
      password: options.password || 'anonymous@',
      secure: Boolean(options.secure),
      timeout: options.timeout || 12000,
      ...options
    };
    this.controlSocket = null;
    this.currentDataSocket = null;
    this.isConnected = false;
    this.commandQueue = [];
    this.activeCommand = null;
    this.buffer = '';
    this.workingDirectory = '/';
    this._transferHandler = null;
    this._waitingForBanner = null;
  }

  /**
   * Connect to the FTP server, authenticate, and discover initial working directory.
   */
  async connect() {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const timeoutTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.destroy();
          reject(new Error(`Connection to FTP server ${this.options.host}:${this.options.port} timed out.`));
        }
      }, this.options.timeout);

      const onConnect = async () => {
        try {
          // Wait for initial 220 banner
          const welcome = await this._waitForResponse();
          if (welcome.code !== 220) {
            throw new Error(`Unexpected welcome banner: ${welcome.message}`);
          }

          // Authenticate
          const userRes = await this.sendCmd(`USER ${this.options.user}`);
          if (userRes.code === 331) {
            const passRes = await this.sendCmd(`PASS ${this.options.password}`);
            if (passRes.code !== 230) {
              throw new Error(`FTP Authentication failed: ${passRes.message}`);
            }
          } else if (userRes.code !== 230) {
            throw new Error(`FTP User rejected: ${userRes.message}`);
          }

          // Switch to Binary mode
          await this.sendCmd('TYPE I');

          // Try enabling UTF-8 support (optional)
          try {
            await this.sendCmd('OPTS UTF8 ON');
          } catch (_) {}

          // Query initial working directory
          try {
            const pwdRes = await this.sendCmd('PWD');
            if (pwdRes && pwdRes.code === 257) {
              const match = pwdRes.message.match(/"([^"]+)"/);
              if (match) {
                this.workingDirectory = match[1];
              }
            }
          } catch (_) {}

          this.isConnected = true;
          clearTimeout(timeoutTimer);
          resolved = true;
          resolve({
            status: 'connected',
            host: this.options.host,
            port: this.options.port,
            workingDirectory: this.workingDirectory
          });
        } catch (err) {
          clearTimeout(timeoutTimer);
          if (!resolved) {
            resolved = true;
            this.destroy();
            reject(err);
          }
        }
      };

      try {
        if (this.options.secure) {
          this.controlSocket = tls.connect({
            host: this.options.host,
            port: this.options.port,
            rejectUnauthorized: false
          }, onConnect);
        } else {
          this.controlSocket = net.connect({
            host: this.options.host,
            port: this.options.port
          }, onConnect);
        }

        this.controlSocket.setEncoding('utf8');

        this.controlSocket.on('data', (chunk) => {
          this._handleControlData(chunk);
        });

        this.controlSocket.on('error', (err) => {
          this.isConnected = false;
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutTimer);
            reject(err);
          } else {
            this.emit('error', err);
          }
        });

        this.controlSocket.on('close', () => {
          this.isConnected = false;
          this.emit('close');
        });
      } catch (err) {
        clearTimeout(timeoutTimer);
        reject(err);
      }
    });
  }

  /**
   * Send a raw FTP command and wait for response.
   */
  async sendCmd(cmd) {
    if (!this.controlSocket || this.controlSocket.destroyed) {
      throw new Error('FTP control socket is not connected');
    }

    return new Promise((resolve, reject) => {
      const commandItem = {
        cmd,
        resolve,
        reject,
        timer: setTimeout(() => {
          reject(new Error(`Command '${cmd}' timed out after ${this.options.timeout}ms`));
        }, this.options.timeout)
      };

      this.commandQueue.push(commandItem);
      this._processQueue();
    });
  }

  _processQueue() {
    if (this.activeCommand || this.commandQueue.length === 0) {
      return;
    }

    this.activeCommand = this.commandQueue.shift();
    try {
      this.controlSocket.write(`${this.activeCommand.cmd}\r\n`);
    } catch (err) {
      clearTimeout(this.activeCommand.timer);
      const rej = this.activeCommand.reject;
      this.activeCommand = null;
      rej(err);
      this._processQueue();
    }
  }

  _handleControlData(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop(); // Keep partial line

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const match = line.match(/^(\d{3})(?: (.*))?$/);
      if (match) {
        const code = parseInt(match[1], 10);
        const message = match[2] || '';
        const response = { code, message, raw: line };

        // 1. Check if waiting for initial 220 banner
        if (this._waitingForBanner) {
          const resolver = this._waitingForBanner;
          this._waitingForBanner = null;
          resolver(response);
          continue;
        }

        // 2. Check if a transfer handler is waiting for 150/226
        if (this._transferHandler) {
          const handled = this._transferHandler(response);
          if (handled) {
            continue;
          }
        }

        // 3. Normal command queue response
        if (this.activeCommand) {
          clearTimeout(this.activeCommand.timer);
          const resolver = this.activeCommand.resolve;
          this.activeCommand = null;
          resolver(response);
          this._processQueue();
        }
      }
    }
  }

  _waitForResponse() {
    return new Promise((resolve) => {
      this._waitingForBanner = resolve;
    });
  }

  /**
   * Enter passive mode (PASV) and return data connection coordinates.
   */
  async pasv() {
    const res = await this.sendCmd('PASV');
    if (res.code !== 227) {
      throw new Error(`PASV command failed: ${res.message}`);
    }

    const match = res.raw.match(/(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    if (!match) {
      throw new Error(`Cannot parse PASV response: ${res.raw}`);
    }

    const hostParts = match.slice(1, 5);
    const p1 = parseInt(match[5], 10);
    const p2 = parseInt(match[6], 10);
    const port = (p1 << 8) + p2;

    let dataHost = hostParts.join('.');

    // NAT Workaround: If server reports an internal IP while connected over public/domain
    if (this.options.host !== '127.0.0.1' && this.options.host !== 'localhost') {
      if (dataHost.startsWith('10.') || dataHost.startsWith('192.168.') || dataHost === '127.0.0.1') {
        dataHost = this.options.host;
      }
    }

    return { host: dataHost, port };
  }

  _openDataSocket(pasvInfo) {
    return new Promise((resolve, reject) => {
      const dataSocket = net.connect({
        host: pasvInfo.host,
        port: pasvInfo.port
      }, () => {
        resolve(dataSocket);
      });

      dataSocket.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Resolve an input path into the actual remote path.
   * If input is '/' or empty, and workingDirectory is set (e.g. '/storage/emulated/0'),
   * it uses workingDirectory.
   */
  resolvePath(inputPath) {
    if (!inputPath || inputPath === '.' || (inputPath === '/' && this.workingDirectory && this.workingDirectory !== '/')) {
      return this.workingDirectory;
    }
    return inputPath;
  }

  /**
   * List files and folders in a remote directory with complete synchronous transfer handling.
   */
  async list(remotePath = '') {
    const targetDir = this.resolvePath(remotePath);
    const pasvInfo = await this.pasv();
    const dataSocket = await this._openDataSocket(pasvInfo);

    const dataChunks = [];
    dataSocket.on('data', (chunk) => {
      dataChunks.push(chunk);
    });

    const dataPromise = new Promise((resolve, reject) => {
      dataSocket.on('close', () => {
        resolve(Buffer.concat(dataChunks).toString('utf8'));
      });
      dataSocket.on('error', reject);
    });

    // Transfer promise monitors preliminary 150/125 and final 226/250 responses
    const transferPromise = new Promise((resolve, reject) => {
      let gotPreliminary = false;
      const timeout = setTimeout(() => {
        this._transferHandler = null;
        reject(new Error(`Transfer timeout on LIST '${targetDir}'`));
      }, this.options.timeout);

      this._transferHandler = (res) => {
        if (!gotPreliminary) {
          if (res.code === 150 || res.code === 125) {
            gotPreliminary = true;
            return true;
          } else {
            clearTimeout(timeout);
            this._transferHandler = null;
            reject(new Error(`List failed: ${res.raw}`));
            return true;
          }
        } else {
          if (res.code === 226 || res.code === 250 || res.code === 200) {
            clearTimeout(timeout);
            this._transferHandler = null;
            resolve(res);
            return true;
          }
        }
        return false;
      };

      // Try MLSD first
      this.controlSocket.write(`MLSD ${targetDir}\r\n`);
    });

    try {
      const [rawListing] = await Promise.all([dataPromise, transferPromise]);
      return this._parseListing(rawListing, targetDir);
    } catch (err) {
      // Fallback to standard LIST if MLSD is not supported
      if (err.message && err.message.includes('500') || err.message.includes('502')) {
        return this._listFallback(targetDir);
      }
      throw err;
    }
  }

  async _listFallback(targetDir) {
    const pasvInfo = await this.pasv();
    const dataSocket = await this._openDataSocket(pasvInfo);
    const dataChunks = [];
    dataSocket.on('data', chunk => dataChunks.push(chunk));

    const dataPromise = new Promise((resolve, reject) => {
      dataSocket.on('close', () => resolve(Buffer.concat(dataChunks).toString('utf8')));
      dataSocket.on('error', reject);
    });

    const transferPromise = new Promise((resolve, reject) => {
      let gotPreliminary = false;
      const timeout = setTimeout(() => {
        this._transferHandler = null;
        reject(new Error(`Transfer timeout on LIST fallback '${targetDir}'`));
      }, this.options.timeout);

      this._transferHandler = (res) => {
        if (!gotPreliminary) {
          if (res.code === 150 || res.code === 125) {
            gotPreliminary = true;
            return true;
          } else {
            clearTimeout(timeout);
            this._transferHandler = null;
            reject(new Error(`LIST fallback failed: ${res.raw}`));
            return true;
          }
        } else {
          if (res.code === 226 || res.code === 250 || res.code === 200) {
            clearTimeout(timeout);
            this._transferHandler = null;
            resolve(res);
            return true;
          }
        }
        return false;
      };

      this.controlSocket.write(`LIST ${targetDir}\r\n`);
    });

    const [rawListing] = await Promise.all([dataPromise, transferPromise]);
    return this._parseListing(rawListing, targetDir);
  }

  _parseListing(rawText, parentPath) {
    const lines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);
    const items = [];
    const normParent = parentPath.endsWith('/') ? parentPath : `${parentPath}/`;

    for (const line of lines) {
      // MLSD format: type=file;size=12345;modify=...; filename
      if (line.includes(';') && line.includes('=')) {
        const parts = line.split(';');
        const namePart = parts.pop().trim();
        if (namePart === '.' || namePart === '..') continue;

        const facts = {};
        for (const p of parts) {
          const [key, val] = p.split('=');
          if (key && val) facts[key.toLowerCase()] = val;
        }

        const isDir = facts.type === 'dir' || facts.type === 'cdir' || facts.type === 'pdir';
        items.push({
          name: namePart,
          path: normParent + namePart,
          isDirectory: isDir,
          size: isDir ? 0 : parseInt(facts.size || '0', 10),
          modified: facts.modify || null
        });
      } else {
        // Standard UNIX or DOS style LIST
        const tokens = line.split(/\s+/);
        if (tokens.length < 4) continue;

        let isDir = false;
        let size = 0;
        let name = '';

        if (line.startsWith('d') || tokens[2] === '<DIR>') {
          isDir = true;
          name = tokens.slice(line.startsWith('d') ? 8 : 3).join(' ');
        } else {
          if (tokens[2] !== '<DIR>') {
            if (tokens.length >= 9 && line.startsWith('-')) {
              size = parseInt(tokens[4], 10) || 0;
              name = tokens.slice(8).join(' ');
            } else {
              size = parseInt(tokens[2], 10) || 0;
              name = tokens.slice(3).join(' ');
            }
          }
        }

        if (name && name !== '.' && name !== '..') {
          items.push({
            name,
            path: normParent + name,
            isDirectory: isDir,
            size,
            modified: null
          });
        }
      }
    }

    return items;
  }

  async size(remotePath) {
    try {
      const res = await this.sendCmd(`SIZE ${remotePath}`);
      if (res.code === 213) {
        return parseInt(res.message.trim(), 10);
      }
    } catch (_) {}
    return 0;
  }

  /**
   * Start streaming a file with optional byte offset (for HTTP Range requests).
   */
  async getStream(remotePath, startOffset = 0) {
    const totalSize = await this.size(remotePath);
    const pasvInfo = await this.pasv();
    const dataSocket = await this._openDataSocket(pasvInfo);

    if (startOffset > 0) {
      const restRes = await this.sendCmd(`REST ${startOffset}`);
      if (restRes.code !== 350) {
        dataSocket.destroy();
        throw new Error(`REST command rejected for offset ${startOffset}: ${restRes.message}`);
      }
    }

    const retrRes = await this.sendCmd(`RETR ${remotePath}`);
    if (retrRes.code !== 150 && retrRes.code !== 125) {
      dataSocket.destroy();
      throw new Error(`RETR command failed for ${remotePath}: ${retrRes.message}`);
    }

    this.currentDataSocket = dataSocket;

    dataSocket.on('close', () => {
      this.currentDataSocket = null;
    });

    return {
      stream: dataSocket,
      totalSize: totalSize || 0,
      startOffset
    };
  }

  destroy() {
    this.isConnected = false;
    this._transferHandler = null;
    this._waitingForBanner = null;

    if (this.currentDataSocket && !this.currentDataSocket.destroyed) {
      this.currentDataSocket.destroy();
      this.currentDataSocket = null;
    }
    if (this.controlSocket && !this.controlSocket.destroyed) {
      try {
        this.controlSocket.write('QUIT\r\n');
      } catch (_) {}
      this.controlSocket.destroy();
      this.controlSocket = null;
    }
  }
}

module.exports = SimpleFtpClient;
