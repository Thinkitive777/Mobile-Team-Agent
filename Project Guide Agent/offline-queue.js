const fs = require('fs');
const path = require('path');
const CONST = require('./constants');
const Logger = require('./logger');

const QUEUE_FILE = path.join(CONST.CONFIG_DIR, 'offline_queue.json');

class OfflineQueue {
  static getQueue() {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    try {
      return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
    } catch (e) {
      Logger.error("Queue file corrupted", { error: e.message });
      return [];
    }
  }

  static saveQueue(queue) {
    try {
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), {
        mode: CONST.CONFIG_FILE_PERMISSIONS || 0o600,
      });
    } catch (err) {
      Logger.error("Failed to save offline queue", { error: err.message });
    }
  }

  static addAction(action) {
    const queue = this.getQueue();
    queue.push({
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      ...action
    });
    this.saveQueue(queue);
    Logger.info("Action queued offline", { action: action.type });
  }

  static clearQueue() {
    this.saveQueue([]);
  }
}

module.exports = OfflineQueue;
