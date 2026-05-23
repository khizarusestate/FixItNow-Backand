const QUEUE_PREFIX = 'email:queue';
const PROCESSING_PREFIX = 'email:processing';

/**
 * Add email job to queue
 */
export const addEmailJob = async (jobData) => {
  const redis = getRedisClient();
  if (!redis) {
    console.warn('Redis not available, email queue disabled');
    return false;
  }

  try {
    const jobId = `email:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const job = {
      id: jobId,
      ...jobData,
      createdAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: 3
    };

    await redis.lpush(QUEUE_PREFIX, JSON.stringify(job));
    console.log(`Email job added to queue: ${jobId}`);
    return jobId;
  } catch (error) {
    console.error('Failed to add email job:', error);
    return false;
  }
};

/**
 * Get next email job from queue
 */
export const getNextEmailJob = async () => {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const jobData = await redis.rpop(QUEUE_PREFIX);
    if (!jobData) return null;

    const job = JSON.parse(jobData);
    
    // Move to processing queue
    await redis.setex(
      `${PROCESSING_PREFIX}:${job.id}`,
      300, // 5 minute timeout
      JSON.stringify(job)
    );

    return job;
  } catch (error) {
    console.error('Failed to get email job:', error);
    return null;
  }
};

/**
 * Mark email job as completed
 */
export const completeEmailJob = async (jobId) => {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    await redis.del(`${PROCESSING_PREFIX}:${jobId}`);
    console.log(`Email job completed: ${jobId}`);
    return true;
  } catch (error) {
    console.error('Failed to complete email job:', error);
    return false;
  }
};

/**
 * Mark email job as failed (retry or give up)
 */
export const failEmailJob = async (jobId, error) => {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const processingKey = `${PROCESSING_PREFIX}:${jobId}`;
    const jobData = await redis.get(processingKey);
    
    if (jobData) {
      const job = JSON.parse(jobData);
      job.attempts += 1;
      job.lastError = error;
      job.lastErrorAt = new Date().toISOString();

      await redis.del(processingKey);

      // Retry if max attempts not reached
      if (job.attempts < job.maxAttempts) {
        await redis.lpush(QUEUE_PREFIX, JSON.stringify(job));
        console.log(`Email job queued for retry: ${jobId} (attempt ${job.attempts})`);
      } else {
        console.error(`Email job failed permanently: ${jobId}`);
        // Could add to dead letter queue here
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to fail email job:', error);
    return false;
  }
};

/**
 * Get queue statistics
 */
export const getQueueStats = async () => {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const queueLength = await redis.llen(QUEUE_PREFIX);
    const processingKeys = await redis.keys(`${PROCESSING_PREFIX}:*`);
    const processingCount = processingKeys.length;

    return {
      pending: queueLength,
      processing: processingCount,
      total: queueLength + processingCount
    };
  } catch (error) {
    console.error('Failed to get queue stats:', error);
    return null;
  }
};

/**
 * Process email queue (worker function)
 */
export const processEmailQueue = async (emailService) => {
  const job = await getNextEmailJob();
  
  if (!job) {
    return false; // No jobs to process
  }

  try {
    console.log(`Processing email job: ${job.id}`);
    
    // Send email based on job type
    switch (job.type) {
      case 'customer_signup':
        await emailService.sendCustomerSignupEmail(job.to, job.name);
        break;
      case 'worker_pending':
        await emailService.sendWorkerPendingEmail(job.to, job.name);
        break;
      case 'worker_approved':
        await emailService.sendWorkerApprovedEmail(job.to, job.name);
        break;
      case 'worker_rejected':
        await emailService.sendWorkerRejectedEmail(job.to, job.name, job.reason);
        break;
      case 'booking_created':
        await emailService.sendBookingCreatedEmail(job.to, job.name, job.bookingId);
        break;
      case 'booking_status':
        await emailService.sendBookingStatusEmail(job.to, job.name, job.status, job.bookingId);
        break;
      default:
        console.warn(`Unknown email job type: ${job.type}`);
    }

    await completeEmailJob(job.id);
    return true;
  } catch (error) {
    console.error(`Failed to process email job ${job.id}:`, error);
    await failEmailJob(job.id, error.message);
    return false;
  }
};

/**
 * Start email queue worker
 */
export const startEmailWorker = (emailService, intervalMs = 5000) => {
  console.log('Starting email queue worker...');
  
  const worker = setInterval(async () => {
    await processEmailQueue(emailService);
  }, intervalMs);

  return worker;
};
