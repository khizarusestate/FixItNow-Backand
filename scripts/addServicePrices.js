import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Service from './models/Service.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fixitnow';

const randomPrices = {
  'Cleaning': { min: 500, max: 2000 },
  'Home Repair': { min: 800, max: 3000 },
  'Electrical': { min: 1000, max: 5000 },
  'Plumbing': { min: 800, max: 4000 },
  'Automotive': { min: 1500, max: 8000 },
  'IT Support': { min: 1000, max: 6000 },
  'Other': { min: 500, max: 2000 }
};

function getRandomPrice(category) {
  const range = randomPrices[category] || randomPrices['Other'];
  return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
}

async function addServicePrices() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all services
    const services = await Service.find({});
    console.log(`Found ${services.length} services`);

    let updatedCount = 0;
    for (const service of services) {
      const randomPrice = getRandomPrice(service.category);
      
      if (service.price === 0 || !service.price) {
        service.price = randomPrice;
        service.estimatedDuration = `${Math.floor(Math.random() * 3) + 1}-${Math.floor(Math.random() * 3) + 4} hours`;
        await service.save();
        console.log(`✓ Updated ${service.name}: Price = ${service.price}, Duration = ${service.estimatedDuration}`);
        updatedCount++;
      } else {
        console.log(`- ${service.name} already has price: ${service.price}`);
      }
    }

    console.log(`\n✅ Updated ${updatedCount} services with random prices`);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
    process.exit(0);
  }
}

addServicePrices();
