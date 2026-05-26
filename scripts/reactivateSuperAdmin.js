/**
 * Reactivates all super admin accounts that have isActive = false.
 * Run once: node scripts/reactivateSuperAdmin.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fixitnow';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const Admin = (await import('../models/Admin.js')).default;

  const result = await Admin.updateMany(
    { role: 'super_admin', isActive: false },
    { $set: { isActive: true } },
  );

  if (result.modifiedCount > 0) {
    console.log(`✓ Reactivated ${result.modifiedCount} super admin account(s).`);
  } else {
    console.log('No deactivated super admin accounts found.');
  }

  const all = await Admin.find({ role: 'super_admin' }).select('name email isActive');
  all.forEach((a) => console.log(`  ${a.email}  isActive=${a.isActive}`));

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
