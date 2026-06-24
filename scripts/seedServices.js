import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { SERVICES_DATA, CATEGORIES } from './servicesData.js';
import Service from './models/Service.js';

dotenv.config();

const seedServices = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fixitnow');
    console.log('✅ MongoDB connected');

    // Clear existing services
    await Service.deleteMany({});
    console.log('🗑️  Cleared existing services');

    // Insert new services
    const services = await Service.insertMany(SERVICES_DATA);
    console.log(`✅ Inserted ${services.length} services`);

    // Log categories summary
    console.log('\n📊 Categories Summary:');
    CATEGORIES.forEach(cat => {
      const count = services.filter(s => s.category === cat.name).length;
      console.log(`  • ${cat.displayName}: ${count} services`);
    });

    console.log('\n✨ Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedServices();
