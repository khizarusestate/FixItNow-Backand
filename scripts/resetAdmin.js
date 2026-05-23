/**
 * Removes ALL admins and creates only the super admin from .env (SUPER_ADMIN_*).
 * Run: node resetAdmin.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fixitnow';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const { resetToSuperAdminOnly } = await import('./services/superAdminSeed.js');
  const superAdmin = await resetToSuperAdminOnly();
  if (!superAdmin) {
    console.error('Failed: set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PIN (8 digits) in .env');
    process.exit(1);
  }

  console.log('Super admin ready:');
  console.log(`  Name:  ${superAdmin.name}`);
  console.log(`  Email: ${superAdmin.email}`);
  console.log(`  Phone: ${superAdmin.phone}`);
  console.log(`  Role:  ${superAdmin.role}`);
  console.log('  Regular admins: none (create via Admin Team in panel)');

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
