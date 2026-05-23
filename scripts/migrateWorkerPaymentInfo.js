/**
 * Migration Script: Move Worker Payment Information to Separate Collection
 *
 * This script migrates payment information from Worker collection to WorkerPayment collection.
 * Run this ONCE during deployment, then remove from codebase.
 *
 * Usage: node migrateWorkerPaymentInfo.js
 */

import mongoose from "mongoose";
import Worker from "./workerSchema.js";
import WorkerPayment from "./models/WorkerPayment.js";
import env from "./utils/env.js";
import logger from "./utils/logger.js";

async function migrate() {
  try {
    logger.info("Starting worker payment migration...");

    // Connect to MongoDB
    await mongoose.connect(env.MONGODB_URI);
    logger.info("Connected to MongoDB");

    // Get all workers with payment info
    const workers = await Worker.find({
      $or: [
        { paymentMethod: { $exists: true, $ne: null } },
        { accountUsername: { $exists: true, $ne: null } },
        { accountNumber: { $exists: true, $ne: null } },
      ],
    });

    logger.info(`Found ${workers.length} workers with payment info`);

    let created = 0;
    let skipped = 0;

    // Migrate each worker's payment info
    for (const worker of workers) {
      try {
        // Check if WorkerPayment already exists
        const existing = await WorkerPayment.findOne({ workerId: worker._id });
        if (existing) {
          logger.warn(
            `WorkerPayment already exists for worker ${worker._id}, skipping`,
          );
          skipped++;
          continue;
        }

        // Create WorkerPayment record
        await WorkerPayment.create({
          workerId: worker._id,
          paymentMethod: worker.paymentMethod || "bank-transfer",
          accountUsername: worker.accountUsername || "",
          accountNumber: worker.accountNumber || "",
          bankName: worker.bankName || "",
          accountHolder: worker.accountHolder || "",
        });

        created++;
      } catch (error) {
        logger.error(`Failed to migrate worker ${worker._id}`, {
          error: error.message,
        });
      }
    }

    logger.info(`Migration complete: ${created} created, ${skipped} skipped`);

    // Disconnect
    await mongoose.disconnect();
    logger.info("Migration finished successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Migration failed", { error: error.message });
    process.exit(1);
  }
}

migrate();
