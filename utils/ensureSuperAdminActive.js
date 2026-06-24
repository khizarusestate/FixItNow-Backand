/**
 * Ensures the super admin account is always active
 * Runs on server startup to fix any deactivated super admin accounts
 */

export async function ensureSuperAdminActive(AdminModel) {
  try {
    // First, find the super admin (or create default if doesn't exist)
    let superAdmin = await AdminModel.findOne({ role: 'super_admin' });
    
    if (!superAdmin) {
      console.log('⚠️  No super admin found in database');
      console.log('📝 Note: Create a super admin account via API');
      return;
    }

    console.log(`\n🔐 Super Admin Status Check:`);
    console.log(`   Email: ${superAdmin.email}`);
    console.log(`   Current isActive: ${superAdmin.isActive}`);

    // If deactivated, reactivate
    if (!superAdmin.isActive) {
      console.log('⚠️  ALERT: Super admin is DEACTIVATED!');
      console.log('🔄 Reactivating super admin account...\n');
      
      const result = await AdminModel.updateOne(
        { role: 'super_admin' },
        { $set: { isActive: true } },
        { new: true }
      );

      if (result.modifiedCount > 0) {
        console.log('✅ Super admin account REACTIVATED successfully!');
        superAdmin = await AdminModel.findOne({ role: 'super_admin' });
      }
    } else {
      console.log('✅ Super admin is ACTIVE and ready\n');
    }

    // Final verification
    if (superAdmin && !superAdmin.isActive) {
      console.error('❌ ERROR: Super admin still deactivated after update!');
      console.error('This should not happen. Check database directly.');
    }
  } catch (error) {
    console.error('❌ Error ensuring super admin is active:', error.message);
  }
}
