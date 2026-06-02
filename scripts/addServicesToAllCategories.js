import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Service from './models/Service.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fixitnow';

const ALL_SERVICES = [
  // Cleaning Services
  {
    name: 'Deep House Cleaning',
    description: 'Complete deep cleaning of your home including all rooms, kitchen, and bathrooms',
    category: 'Cleaning',
    icon: 'Sparkles',
    price: 1500,
    estimatedDuration: '3-4 hours'
  },
  {
    name: 'Office Cleaning',
    description: 'Professional cleaning services for offices and commercial spaces',
    category: 'Cleaning',
    icon: 'Sparkles',
    price: 2000,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'Carpet Cleaning',
    description: 'Deep carpet cleaning using professional equipment and cleaning solutions',
    category: 'Cleaning',
    icon: 'Sparkles',
    price: 800,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Window Cleaning',
    description: 'Professional window cleaning for residential and commercial properties',
    category: 'Cleaning',
    icon: 'Sparkles',
    price: 500,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Move-in/Move-out Cleaning',
    description: 'Thorough cleaning for moving in or out of a property',
    category: 'Cleaning',
    icon: 'Sparkles',
    price: 2500,
    estimatedDuration: '4-5 hours'
  },

  // Home Repair Services
  {
    name: 'Door Repair',
    description: 'Fix broken doors, hinges, locks, and frames',
    category: 'Home Repair',
    icon: 'Hammer',
    price: 800,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Wall Repair',
    description: 'Repair holes, cracks, and damage to walls and ceilings',
    category: 'Home Repair',
    icon: 'Hammer',
    price: 1200,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'Floor Repair',
    description: 'Repair damaged flooring including tiles, wood, and laminate',
    category: 'Home Repair',
    icon: 'Hammer',
    price: 1500,
    estimatedDuration: '2-4 hours'
  },
  {
    name: 'Furniture Assembly',
    description: 'Assembly of all types of furniture including beds, tables, and cabinets',
    category: 'Home Repair',
    icon: 'Hammer',
    price: 1000,
    estimatedDuration: '1-3 hours'
  },
  {
    name: 'Drywall Repair',
    description: 'Professional drywall repair and patching services',
    category: 'Home Repair',
    icon: 'Hammer',
    price: 1000,
    estimatedDuration: '2-3 hours'
  },

  // Electrical Services
  {
    name: 'Electrical Wiring',
    description: 'Complete electrical wiring for new construction and renovations',
    category: 'Electrical',
    icon: 'Zap',
    price: 3000,
    estimatedDuration: '4-6 hours'
  },
  {
    name: 'Switch & Socket Installation',
    description: 'Installation and replacement of electrical switches and sockets',
    category: 'Electrical',
    icon: 'Zap',
    price: 500,
    estimatedDuration: '30-60 minutes'
  },
  {
    name: 'Fan Installation',
    description: 'Installation of ceiling fans and exhaust fans',
    category: 'Electrical',
    icon: 'Zap',
    price: 800,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Light Installation',
    description: 'Installation of all types of indoor and outdoor lighting',
    category: 'Electrical',
    icon: 'Zap',
    price: 600,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Circuit Breaker Repair',
    description: 'Diagnosis and repair of circuit breaker issues',
    category: 'Electrical',
    icon: 'Zap',
    price: 1500,
    estimatedDuration: '1-2 hours'
  },

  // Plumbing Services
  {
    name: 'Leak Repair',
    description: 'Fix all types of water leaks including pipes, faucets, and fixtures',
    category: 'Plumbing',
    icon: 'Droplets',
    price: 800,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Drain Cleaning',
    description: 'Professional drain cleaning and unclogging services',
    category: 'Plumbing',
    icon: 'Droplets',
    price: 1000,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Pipe Installation',
    description: 'Installation of new pipes for water supply and drainage',
    category: 'Plumbing',
    icon: 'Droplets',
    price: 2000,
    estimatedDuration: '3-4 hours'
  },
  {
    name: 'Toilet Repair',
    description: 'Repair and maintenance of toilet fixtures and plumbing',
    category: 'Plumbing',
    icon: 'Droplets',
    price: 600,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Water Heater Installation',
    description: 'Installation of water heaters and geysers',
    category: 'Plumbing',
    icon: 'Droplets',
    price: 2500,
    estimatedDuration: '2-3 hours'
  },

  // Automotive Services
  {
    name: 'Car AC Repair',
    description: 'Diagnosis and repair of vehicle air conditioning systems',
    category: 'Automotive',
    icon: 'Car',
    price: 3000,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'Oil Change',
    description: 'Complete oil change service with filter replacement',
    category: 'Automotive',
    icon: 'Car',
    price: 1500,
    estimatedDuration: '30-60 minutes'
  },
  {
    name: 'Brake Repair',
    description: 'Brake pad replacement and brake system repair',
    category: 'Automotive',
    icon: 'Car',
    price: 2500,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Battery Replacement',
    description: 'Car battery testing and replacement service',
    category: 'Automotive',
    icon: 'Car',
    price: 2000,
    estimatedDuration: '30-45 minutes'
  },
  {
    name: 'Engine Tune-up',
    description: 'Complete engine tune-up and performance optimization',
    category: 'Automotive',
    icon: 'Car',
    price: 4000,
    estimatedDuration: '2-3 hours'
  },

  // IT Support Services
  {
    name: 'Computer Repair',
    description: 'Hardware and software repair for desktop and laptop computers',
    category: 'IT Support',
    icon: 'Monitor',
    price: 1500,
    estimatedDuration: '1-3 hours'
  },
  {
    name: 'Network Setup',
    description: 'Home and office network installation and configuration',
    category: 'IT Support',
    icon: 'Monitor',
    price: 2000,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Software Installation',
    description: 'Installation and configuration of software and operating systems',
    category: 'IT Support',
    icon: 'Monitor',
    price: 1000,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Virus Removal',
    description: 'Complete virus and malware removal and system cleanup',
    category: 'IT Support',
    icon: 'Monitor',
    price: 1200,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Data Recovery',
    description: 'Data recovery from damaged or corrupted storage devices',
    category: 'IT Support',
    icon: 'Monitor',
    price: 3000,
    estimatedDuration: '2-4 hours'
  },

  // Carpentry Services
  {
    name: 'Custom Furniture',
    description: 'Design and build custom furniture to your specifications',
    category: 'Carpentry',
    icon: 'Wrench',
    price: 5000,
    estimatedDuration: '1-3 days'
  },
  {
    name: 'Cabinet Installation',
    description: 'Installation of kitchen and bathroom cabinets',
    category: 'Carpentry',
    icon: 'Wrench',
    price: 3000,
    estimatedDuration: '4-6 hours'
  },
  {
    name: 'Shelving Installation',
    description: 'Custom shelving solutions for homes and offices',
    category: 'Carpentry',
    icon: 'Wrench',
    price: 2000,
    estimatedDuration: '2-4 hours'
  },
  {
    name: 'Door Installation',
    description: 'Installation of interior and exterior doors',
    category: 'Carpentry',
    icon: 'Wrench',
    price: 2500,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'Deck Repair',
    description: 'Repair and maintenance of wooden decks and outdoor structures',
    category: 'Carpentry',
    icon: 'Wrench',
    price: 3500,
    estimatedDuration: '4-6 hours'
  },

  // Painting Services
  {
    name: 'Interior Painting',
    description: 'Professional interior painting for all rooms and surfaces',
    category: 'Painting',
    icon: 'Paintbrush',
    price: 3000,
    estimatedDuration: '1-2 days'
  },
  {
    name: 'Exterior Painting',
    description: 'Exterior painting for homes and commercial buildings',
    category: 'Painting',
    icon: 'Paintbrush',
    price: 5000,
    estimatedDuration: '2-3 days'
  },
  {
    name: 'Wallpaper Installation',
    description: 'Professional wallpaper installation and removal',
    category: 'Painting',
    icon: 'Paintbrush',
    price: 2000,
    estimatedDuration: '1-2 days'
  },
  {
    name: 'Texture Painting',
    description: 'Textured painting and decorative wall finishes',
    category: 'Painting',
    icon: 'Paintbrush',
    price: 3500,
    estimatedDuration: '1-2 days'
  },
  {
    name: 'Touch-up Painting',
    description: 'Minor touch-ups and paint repairs',
    category: 'Painting',
    icon: 'Paintbrush',
    price: 1000,
    estimatedDuration: '2-4 hours'
  },

  // HVAC Services
  {
    name: 'AC Installation',
    description: 'Installation of split and window air conditioners',
    category: 'HVAC',
    icon: 'Wind',
    price: 4000,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'AC Repair',
    description: 'Diagnosis and repair of air conditioning units',
    category: 'HVAC',
    icon: 'Wind',
    price: 2000,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'AC Maintenance',
    description: 'Regular maintenance and servicing of AC units',
    category: 'HVAC',
    icon: 'Wind',
    price: 1500,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Heater Installation',
    description: 'Installation of room heaters and heating systems',
    category: 'HVAC',
    icon: 'Wind',
    price: 3000,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'Ventilation Cleaning',
    description: 'Cleaning and maintenance of ventilation systems',
    category: 'HVAC',
    icon: 'Wind',
    price: 2000,
    estimatedDuration: '2-3 hours'
  },

  // Appliance Services
  {
    name: 'Refrigerator Repair',
    description: 'Diagnosis and repair of refrigerators and freezers',
    category: 'Appliance',
    icon: 'Lightbulb',
    price: 2000,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Washing Machine Repair',
    description: 'Repair of washing machines and dryers',
    category: 'Appliance',
    icon: 'Lightbulb',
    price: 1800,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Microwave Repair',
    description: 'Repair and maintenance of microwave ovens',
    category: 'Appliance',
    icon: 'Lightbulb',
    price: 1000,
    estimatedDuration: '30-60 minutes'
  },
  {
    name: 'Dishwasher Repair',
    description: 'Diagnosis and repair of dishwashers',
    category: 'Appliance',
    icon: 'Lightbulb',
    price: 1500,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'TV Repair',
    description: 'Repair of LED, LCD, and plasma TVs',
    category: 'Appliance',
    icon: 'Lightbulb',
    price: 2500,
    estimatedDuration: '1-2 hours'
  },

  // General Maintenance Services
  {
    name: 'Handyman Services',
    description: 'General handyman services for various home repairs',
    category: 'General Maintenance',
    icon: 'Home',
    price: 1000,
    estimatedDuration: '1-3 hours'
  },
  {
    name: 'Garden Maintenance',
    description: 'Lawn mowing, trimming, and garden care',
    category: 'General Maintenance',
    icon: 'Home',
    price: 1500,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'Pest Control',
    description: 'Professional pest control and extermination services',
    category: 'General Maintenance',
    icon: 'Home',
    price: 2000,
    estimatedDuration: '1-2 hours'
  },
  {
    name: 'Pool Maintenance',
    description: 'Pool cleaning and maintenance services',
    category: 'General Maintenance',
    icon: 'Home',
    price: 2500,
    estimatedDuration: '2-3 hours'
  },
  {
    name: 'Security System Installation',
    description: 'Installation of home security systems and cameras',
    category: 'General Maintenance',
    icon: 'Home',
    price: 4000,
    estimatedDuration: '3-4 hours'
  }
];

async function addServices() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    let addedCount = 0;
    let skippedCount = 0;

    for (const serviceData of ALL_SERVICES) {
      try {
        // Check if service already exists
        const existingService = await Service.findOne({ 
          name: { $regex: new RegExp(`^${serviceData.name}$`, 'i') } 
        });

        if (existingService) {
          console.log(`Skipped: ${serviceData.name} (already exists)`);
          skippedCount++;
          continue;
        }

        const service = new Service(serviceData);
        await service.save();
        console.log(`Added: ${serviceData.name} (${serviceData.category})`);
        addedCount++;
      } catch (err) {
        console.error(`Error adding ${serviceData.name}:`, err.message);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total services processed: ${ALL_SERVICES.length}`);
    console.log(`Services added: ${addedCount}`);
    console.log(`Services skipped: ${skippedCount}`);

    await mongoose.connection.close();
    console.log('Database connection closed');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

addServices();
