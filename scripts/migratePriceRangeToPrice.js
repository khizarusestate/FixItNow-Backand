import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Service from './models/Service.js';

dotenv.config();

/**
 * Migration Script: Convert priceRange.max to single price field
 * 
 * This script migrates existing services from priceRange (min/max) to a single price field.
 * Migration strategy:
 * - If priceRange.max exists and > 0, use it as the new price
 * - If priceRange.max is 0 or missing, use priceRange.min if > 0
 * - If both are 0 or missing, default to 0
 * - After migration, priceRange field will be removed from schema
 */

async function migrateServices() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fixitnow');
    console.log('✅ MongoDB connected');

    // Get all services
    const services = await Service.find({});
    console.log(`📊 Found ${services.length} services to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const service of services) {
      try {
        // Determine new price from priceRange
        let newPrice = 0;
        
        if (service.priceRange && service.priceRange.max > 0) {
          newPrice = service.priceRange.max;
        } else if (service.priceRange && service.priceRange.min > 0) {
          newPrice = service.priceRange.min;
        } else if (service.basePrice && service.basePrice > 0) {
          newPrice = service.basePrice;
        }

        // Only update if price is different
        if (service.price !== newPrice) {
          service.price = newPrice;
          await service.save();
          console.log(`✅ Migrated: ${service.name} - priceRange: ${service.priceRange?.min || 0}-${service.priceRange?.max || 0} → price: ${newPrice}`);
          migratedCount++;
        } else {
          console.log(`⏭️  Skipped: ${service.name} - already has price ${service.price}`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error migrating ${service.name}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Migrated: ${migratedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📊 Total: ${services.length}`);

    console.log('\n✨ Migration completed successfully!');
    console.log('📝 Next steps:');
    console.log('   1. Update all backend routes to use price instead of priceRange');
    console.log('   2. Update frontend components to display single price');
    console.log('   3. Update seed data to use price field');
    console.log('   4. Remove priceRange field from Service schema (after verification)');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateServices();
