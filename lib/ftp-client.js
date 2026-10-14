const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');

/**
 * Pure Node.js FTP / FTPS Client
 * Zero external dependencies, runs natively on any standard Node.js runtime (including Tizen OS).
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
  }

  /**
   * Connect to the FTP server and authenticate.
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

          // Try enabling UTF-8 support (optional, ignore if not supported)
          try {
            await this.sendCmd('OPTS UTF8 ON');
          } catch (_) {
            // Some older FTP servers don't support OPTS UTF8, ignore
          }

          this.isConnected = true;
          clearTimeout(timeoutTimer);
          resolved = true;
          resolve({ status: 'connected', host: this.options.host, port: this.options.port });
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

      // Check if line is the final response line (e.g. "220 ..." or "230-..." for multiline)
      const match = line.match(/^(\d{3})(?: (.*))?$/);
      if (match) {
        const code = parseInt(match[1], 10);
        const message = match[2] || '';
        const response = { code, message, raw: line };

        if (this._waitingForBanner) {
          const resolver = this._waitingForBanner;
          this._waitingForBanner = null;
          resolver(response);
          continue;
        }

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

    // Matches PASV string: 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
    const match = res.raw.match(/(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    if (!match) {
      throw new Error(`Cannot parse PASV response: ${res.raw}`);
    }

    const hostParts = match.slice(1, 5);
    const p1 = parseInt(match[5], 10);
    const p2 = parseInt(match[6], 10);
    const port = (p1 << 8) + p2;

    let dataHost = hostParts.join('.');

    // NAT Workaround: If server reports an internal LAN/WAN IP (e.g. 10.x, 192.168.x, 172.16.x)
    // or 127.0.0.1 while connected to a different public hostname/IP, override with control host.
    if (this.options.host !== '127.0.0.1' && this.options.host !== 'localhost') {
      if (dataHost.startsWith('10.') || dataHost.startsWith('192.168.') || dataHost === '127.0.0.1') {
        dataHost = this.options.host;
      }
    }

    return { host: dataHost, port };
  }

  /**
   * Open data socket based on PASV coordinates.
   */
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
   * List files and folders in a remote directory.
   */
  async list(remotePath = '/') {
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

    // Send MLSD or fallback to LIST
    let listCmd = `MLSD ${remotePath}`;
    let listRes;
    try {
      listRes = await this.sendCmd(listCmd);
    } catch (_) {
      listCmd = `LIST ${remotePath}`;
      listRes = await this.sendCmd(listCmd);
    }

    if (listRes.code !== 150 && listRes.code !== 125) {
      dataSocket.destroy();
      throw new Error(`Listing failed on ${remotePath}: ${listRes.message}`);
    }

    const rawListing = await dataPromise;
    // Wait for the final 226 Transfer complete on control connection
    await this._waitForCode([226, 250]);

    return this._parseListing(rawListing, remotePath);
  }

  _waitForCode(expectedCodes) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, 5000);

      const check = (res) => {
        clearTimeout(timer);
        resolve(res);
      };

      // If activeCommand isn't handling it, wait for response
      this._waitingForBanner = check;
    });
  }

  /**
   * Parse MLSD or UNIX/Windows format directory listing.
   */
  _parseListing(rawText, parentPath) {
    const lines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);
    const items = [];

    const normParent = parentPath.endsWith('/') ? parentPath : `${parentPath}/`;

    for (const line of lines) {
      // MLSD format: type=file;size=12345;modify=2023...; filename
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
        // Standard UNIX or DOS style LIST line
        // UNIX: -rw-r--r-- 1 ftp ftp 104857600 Oct 14 09:30 movie.mkv
        // DOS:  05-12-23  09:30PM       104857600 movie.mkv
        const tokens = line.split(/\s+/);
        if (tokens.length < 4) continue;

        let isDir = false;
        let size = 0;
        let name = '';

        if (line.startsWith('d') || tokens[2] === '<DIR>') {
          isDir = true;
          name = tokens.slice(line.startsWith('d') ? 8 : 3).join(' ');
        } else {
          // Find size and name
          if (tokens[2] !== '<DIR>') {
            // UNIX: 5th column is usually size
            if (tokens.length >= 9 && line.startsWith('-')) {
              size = parseInt(tokens[4], 10) || 0;
              name = tokens.slice(8).join(' ');
            } else {
              // DOS: 3rd token is size
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

  /**
   * Get size of a remote file.
   */
  async size(remotePath) {
    try {
      const res = await this.sendCmd(`SIZE ${remotePath}`);
      if (res.code === 213) {
        return parseInt(res.message.trim(), 10);
      }
    } catch (_) {
      // Fallback: list parent folder
    }
    return 0;
  }

  /**
   * Start streaming a file with optional byte offset (for HTTP Range requests).
   * Returns: { stream: net.Socket, size: number }
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

  /**
   * Close connections cleanly.
   */
  destroy() {
    this.isConnected = false;
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
