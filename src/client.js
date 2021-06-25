const WebSocket = require("ws");
const { defer } = require("./utils");

// Simple protocol client for use in writing standalone applications.

class ProtocolClient {
  constructor(address, callbacks) {
    this.socket = new WebSocket(address);
    this.callbacks = callbacks;

    // Internal state.
    this.pendingMessages = new Map();
    this.nextMessageId = 1;

    this.socket.on("open", callbacks.onOpen);
    this.socket.on("close", callbacks.onClose);
    this.socket.on("error", callbacks.onError);
    this.socket.on("message", message => this.onMessage(message));
  }

  close() {
    this.socket.close();
  }

  async sendCommand(method, params, data) {
    const id = this.nextMessageId++;
    this.socket.send(JSON.stringify({ id, method, params, binary: data ? true : undefined }));
    if (data) {
      this.socket.send(data);
    }
    const waiter = defer();
    this.pendingMessages.set(id, waiter);
    return waiter.promise;
  }

  onMessage(contents) {
    const msg = JSON.parse(contents);
    if (msg.id) {
      const { resolve, reject } = this.pendingMessages.get(msg.id);
      this.pendingMessages.delete(msg.id);
      if (msg.result) {
        resolve(msg.result);
      } else {
        reject(`Channel error: ${JSON.stringify(msg)}`);
      }
    } else {
      throw new Error("Events NYI");
    }
  }
}

module.exports = ProtocolClient;
