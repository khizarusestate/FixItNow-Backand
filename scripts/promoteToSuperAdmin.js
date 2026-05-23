/**
 * Promotes an existing admin to super_admin without deleting other admins.
 * Usage: node scripts/promoteToSuperAdmin.js [email]
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Admin from '../models/Admin.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fixitnow';
const email = (process.argv[2] || 'khizarusestate@gmail.com').toLowerCase().trim();

async function run() {
  await mongoose.connect(MONGODB_URI);
  const admin = await Admin.findOneAndUpdate(
    { email },
    { role: 'super_admin', isActive: true },
    { new: true },
  ).select('-pin');

  if (!admin) {
    console.error(`No admin found with email: ${email}`);
    process.exit(1);
  }

  console.log(`Promoted to super_admin: ${admin.name} <${admin.email}>`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
