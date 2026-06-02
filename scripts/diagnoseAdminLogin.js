/**
 * Diagnostic script: shows ALL admins with their isActive status
 * and fixes any admin whose isActive is false (except super_admin).
 *
 * Usage: node scripts/diagnoseAdminLogin.js
 *   → Diagnose + auto-fix all deactivated regular admins
 *
 * Usage: node scripts/diagnoseAdminLogin.js --email admin@example.com
 *   → Diagnose + fix only that email
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set in environment!');
  process.exit(1);
}

const emailArg = (() => {
  const idx = process.argv.indexOf('--email');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  const Admin = (await import('../models/Admin.js')).default;

  // ── Show all admins ──────────────────────────────────
  const all = await Admin.find({}).select('name email role isActive failedLoginAttempts lockUntil');
  console.log('=== ALL ADMIN ACCOUNTS ===');
  all.forEach((a) => {
    const locked = a.lockUntil && a.lockUntil > new Date();
    console.log(
      `  [${a.role.padEnd(12)}]  isActive=${String(a.isActive).padEnd(5)}  ` +
      `locked=${locked}  fails=${a.failedLoginAttempts || 0}  ` +
      `email=${a.email}`
    );
  });
  console.log('');

  // ── Fix deactivated regular admins ──────────────────
  const query = emailArg
    ? { email: emailArg.toLowerCase().trim(), role: 'admin' }
    : { role: 'admin', isActive: false };

  const deactivated = await Admin.find(query).select('name email isActive lockUntil failedLoginAttempts');

  if (deactivated.length === 0) {
    console.log(emailArg
      ? `ℹ️  Admin with email "${emailArg}" not found or already active.`
      : 'ℹ️  No deactivated regular admins found in DB.'
    );
  } else {
    for (const admin of deactivated) {
      admin.isActive = true;
      admin.failedLoginAttempts = 0;
      admin.lockUntil = null;
      await admin.save({ validateBeforeSave: false });
      console.log(`✅ Fixed: ${admin.email} → isActive=true, lockUntil=null, failedAttempts=0`);
    }
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Script failed:', err.message);
  process.exit(1);
});
