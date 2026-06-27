/**
 * FILE: backend/utils/notificationManager.js
 * 
 * Manages all push notifications with 3-layer fallback system:
 * 1. Socket.io (Real-time)
 * 2. FCM (Push notification)
 * 3. Database (Fallback)
 */

export class NotificationManager {
  constructor(io, fcm, db) {
    this.io = io;
    this.fcm = fcm;
    this.db = db;
    this.retryQueue = [];
    this.maxRetries = 3;
  }

  /**
   * Send notification with fallback system
   * Priority: Socket.io → FCM → Database Queue
   */
  async sendNotification(userId, notification) {
    try {
      // TRY 1: Socket.io (Real-time)
      const socketSuccess = await this.sendViaSocket(userId, notification);
      if (socketSuccess) {
        console.log(`✓ Notification sent via Socket to ${userId}`);
        return { success: true, method: 'socket' };
      }

      // TRY 2: FCM (Push notification)
      const fcmSuccess = await this.sendViaFCM(userId, notification);
      if (fcmSuccess) {
        console.log(`✓ Notification sent via FCM to ${userId}`);
        return { success: true, method: 'fcm' };
      }

      // TRY 3: Database (Fallback - will be polled)
      await this.saveToDatabase(userId, notification);
      console.log(`✓ Notification saved to database for ${userId}`);
      return { success: true, method: 'database' };

    } catch (error) {
      console.error(`✗ All notification methods failed for ${userId}:`, error.message);
      
      // Add to retry queue
      this.retryQueue.push({
        userId,
        notification,
        attempts: 0,
        nextRetry: Date.now() + 5000
      });

      return { success: false, error: error.message };
    }
  }

  async sendViaSocket(userId, notification) {
    try {
      if (!this.io) return false;
      
      this.io.to(`user-${userId}`).emit('notification', {
        ...notification,
        timestamp: new Date().toISOString(),
        id: Math.random().toString(36).substr(2, 9)
      });
      
      return true;
    } catch (error) {
      console.warn(`Socket delivery failed: ${error.message}`);
      return false;
    }
  }

  async sendViaFCM(userId, notification) {
    try {
      if (!this.fcm) return false;

      // Get user's FCM token from database
      const user = await this.db.Worker.findById(userId).select('fcmToken').catch(() => null) || 
                   await this.db.Customer.findById(userId).select('fcmToken').catch(() => null);
      
      if (!user?.fcmToken) {
        console.warn(`No FCM token for user ${userId}`);
        return false;
      }

      // Send push notification
      await this.fcm.send({
        token: user.fcmToken,
        notification: {
          title: notification.title,
          body: notification.message,
        },
        data: {
          type: notification.type,
          entityId: notification.entityId || '',
        }
      });

      return true;
    } catch (error) {
      console.warn(`FCM delivery failed: ${error.message}`);
      return false;
    }
  }

  async saveToDatabase(userId, notification) {
    try {
      // Only save if Notification model exists
      if (this.db.Notification) {
        await this.db.Notification.create({
          userId,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          entityId: notification.entityId,
          read: false,
          createdAt: new Date()
        });
      }
      return true;
    } catch (error) {
      console.error(`Database notification save failed: ${error.message}`);
      throw error;
    }
  }

  // Retry failed notifications
  async processRetryQueue() {
    const now = Date.now();
    const itemsToRetry = this.retryQueue.filter(item => item.nextRetry <= now);

    for (const item of itemsToRetry) {
      if (item.attempts >= this.maxRetries) {
        console.error(`Max retries reached for user ${item.userId}`);
        this.retryQueue = this.retryQueue.filter(i => i !== item);
        continue;
      }

      item.attempts++;
      const result = await this.sendNotification(item.userId, item.notification);
      
      if (result.success) {
        this.retryQueue = this.retryQueue.filter(i => i !== item);
      } else {
        // Exponential backoff
        item.nextRetry = now + (5000 * Math.pow(2, item.attempts - 1));
      }
    }
  }

  logStatus() {
    console.log(`📊 Notification Queue Status: ${this.retryQueue.length} pending retries`);
  }
}

export default NotificationManager;
