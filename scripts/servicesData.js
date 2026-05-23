// 30 Services organized in 6 Categories
export const SERVICES_DATA = [
  // ===== CATEGORY 1: Cleaning Services =====
  {
    name: "Home Deep Cleaning",
    description: "Complete home deep cleaning including dusting, mopping, bathroom sanitization, and kitchen cleaning. Professional equipment and eco-friendly products used.",
    category: "Cleaning",
    icon: "Sparkles",
    image: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=80",
    price: 3500,
    estimatedDuration: "4-6 hours",
    requirements: ["Water supply", "Electricity", "Access to all rooms"]
  },
  {
    name: "Sofa & Carpet Cleaning",
    description: "Professional steam cleaning for sofas, carpets, and upholstery. Removes stains, dust mites, and allergens for a healthier home environment.",
    category: "Cleaning",
    icon: "Sofa",
    image: "https://images.unsplash.com/photo-1558317374-067fb5f30001?auto=format&fit=crop&w=900&q=80",
    price: 2500,
    estimatedDuration: "2-4 hours",
    requirements: ["Parking space", "Water supply", "Items to be cleaned accessible"]
  },
  {
    name: "Kitchen Cleaning",
    description: "Thorough kitchen cleaning including degreasing, chimney cleaning, appliance exterior cleaning, and tile scrubbing. Leaves kitchen sparkling clean.",
    category: "Cleaning",
    icon: "UtensilsCrossed",
    image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=900&q=80",
    price: 1800,
    estimatedDuration: "2-3 hours",
    requirements: ["Empty counters", "Water supply", "Electricity"]
  },
  {
    name: "Bathroom Cleaning",
    description: "Complete bathroom sanitization including tile scrubbing, fixture polishing, mirror cleaning, and mold removal. Disinfection included.",
    category: "Cleaning",
    icon: "Bath",
    image: "https://images.unsplash.com/photo-1584622050111-993a426fbf0a?auto=format&fit=crop&w=900&q=80",
    price: 1200,
    estimatedDuration: "1-2 hours",
    requirements: ["Water supply", "Drainage access"]
  },
  {
    name: "Post-Construction Cleaning",
    description: "Specialized cleaning after renovation or construction. Removes dust, paint marks, and debris. Heavy-duty cleaning for new or renovated spaces.",
    category: "Cleaning",
    icon: "Building2",
    image: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=80",
    price: 6000,
    estimatedDuration: "6-10 hours",
    requirements: ["Construction completed", "Water supply", "Electricity", "Waste disposal access"]
  },

  // ===== CATEGORY 2: Home Repair & Maintenance =====
  {
    name: "Carpentry Work",
    description: "Custom furniture repair, door and window fitting, cabinet installation, and woodwork repairs. Skilled carpenters for all wood-related needs.",
    category: "Home Repair",
    icon: "Hammer",
    image: "https://images.unsplash.com/photo-1581091870627-3d8b9d6c1b2d?auto=format&fit=crop&w=900&q=80",
    price: 3000,
    estimatedDuration: "2-6 hours",
    requirements: ["Material availability", "Workspace access", "Electrical power if needed"]
  },
  {
    name: "Painting Services",
    description: "Interior and exterior painting with premium quality paints. Includes wall preparation, crack filling, and professional finishing for lasting results.",
    category: "Home Repair",
    icon: "Paintbrush",
    image: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=900&q=80",
    price: 35, // per sq ft
    estimatedDuration: "1-3 days",
    requirements: ["Color selection", "Clear walls", "Furniture moved", "Ventilation"]
  },
  {
    name: "Door & Window Repair",
    description: "Repair and alignment of doors, windows, and frames. Handle replacement, lock installation, hinge fixing, and weather stripping.",
    category: "Home Repair",
    icon: "DoorOpen",
    image: "https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=900&q=80",
    price: 1500,
    estimatedDuration: "1-3 hours",
    requirements: ["Access to doors/windows", "Replacement parts if needed"]
  },
  {
    name: "Furniture Assembly",
    description: "Professional assembly of new furniture including beds, wardrobes, shelves, tables, and office furniture. Proper tools and expertise.",
    category: "Home Repair",
    icon: "Wrench",
    image: "https://images.unsplash.com/photo-1582582494700-5f6fef49d7c0?auto=format&fit=crop&w=900&q=80",
    price: 2000,
    estimatedDuration: "1-4 hours",
    requirements: ["Furniture pieces available", "Clear workspace", "Assembly instructions"]
  },
  {
    name: "General Handyman",
    description: "All-purpose handyman services for small repairs, installations, and maintenance tasks around the home. Hangers, fixtures, and minor fixes.",
    category: "Home Repair",
    icon: "Tool",
    image: "https://images.unsplash.com/photo-1598300056393-4aac492f4344?auto=format&fit=crop&w=900&q=80",
    price: 1200,
    estimatedDuration: "1-4 hours",
    requirements: ["List of tasks", "Access to areas", "Materials if specific needed"]
  },

  // ===== CATEGORY 3: Electrical & Electronics =====
  {
    name: "Electrical Wiring & Repair",
    description: "Complete electrical solutions including wiring, switchboard installation, circuit repairs, and electrical troubleshooting. Licensed electricians only.",
    category: "Electrical",
    icon: "Zap",
    image: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&w=900&q=80",
    price: 2500,
    estimatedDuration: "1-4 hours",
    requirements: ["Power off capability", "Access to electrical panel", "Clear work area"]
  },
  {
    name: "Fan & Light Installation",
    description: "Installation and repair of ceiling fans, exhaust fans, LED lights, tube lights, and decorative lighting fixtures. Safe and professional fitting.",
    category: "Electrical",
    icon: "Lightbulb",
    image: "https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?auto=format&fit=crop&w=900&q=80",
    price: 1500,
    estimatedDuration: "1-2 hours",
    requirements: ["Fan/light fixture available", "Ceiling height access", "Power supply"]
  },
  {
    name: "AC Installation & Service",
    description: "Split and window AC installation, uninstallation, gas refilling, and comprehensive servicing. Cooling efficiency restoration and maintenance.",
    category: "Electrical",
    icon: "Wind",
    image: "https://images.unsplash.com/photo-1617103996702-96ff29b1c703?auto=format&fit=crop&w=900&q=80",
    price: 3000,
    estimatedDuration: "2-4 hours",
    requirements: ["AC unit available", "Mounting space", "Power point nearby", "Outdoor unit placement"]
  },
  {
    name: "TV & Appliance Installation",
    description: "Wall mounting of TVs with proper bracket installation, home theater setup, and appliance installation with proper electrical connections.",
    category: "Electrical",
    icon: "Tv",
    image: "https://images.unsplash.com/photo-1593784991095-a205069470b6?auto=format&fit=crop&w=900&q=80",
    price: 2000,
    estimatedDuration: "1-3 hours",
    requirements: ["TV/appliance available", "Wall mount bracket", "Power outlet access", "Cable management preference"]
  },
  {
    name: "Inverter & Battery Setup",
    description: "Inverter installation, battery replacement, UPS setup, and power backup solutions. Complete power backup system for homes and offices.",
    category: "Electrical",
    icon: "BatteryCharging",
    image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=900&q=80",
    price: 5000,
    estimatedDuration: "2-4 hours",
    requirements: ["Inverter unit available", "Battery space", "Main power access", "Ventilation for battery"]
  },

  // ===== CATEGORY 4: Plumbing & Water =====
  {
    name: "Leakage Repair",
    description: "Fix all types of water leaks including taps, pipes, tanks, and bathroom fittings. Pressure testing and complete leak sealing solutions.",
    category: "Plumbing",
    icon: "Droplets",
    image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=900&q=80",
    price: 1500,
    estimatedDuration: "1-3 hours",
    requirements: ["Water supply access", "Leak location identified", "Replacement parts if needed"]
  },
  {
    name: "Drain Unblocking",
    description: "Clear clogged drains, sinks, wash basins, and sewer lines using professional equipment. High-pressure jetting for stubborn blockages.",
    category: "Plumbing",
    icon: "Pipe",
    image: "https://images.unsplash.com/photo-1585705879241-a1387eb12d79?auto=format&fit=crop&w=900&q=80",
    price: 2000,
    estimatedDuration: "1-3 hours",
    requirements: ["Drain access point", "Water supply", "Waste disposal access"]
  },
  {
    name: "Bathroom Fitting",
    description: "Installation and replacement of taps, showers, commodes, wash basins, and bathroom accessories. Plumbing for new bathrooms or renovations.",
    category: "Plumbing",
    icon: "Faucet",
    image: "https://images.unsplash.com/photo-1584622050111-993a426fbf0a?auto=format&fit=crop&w=900&q=80",
    price: 3000,
    estimatedDuration: "2-5 hours",
    requirements: ["New fittings available", "Water connection point", "Drainage access"]
  },
  {
    name: "Water Tank Cleaning",
    description: "Underground and overhead tank cleaning with sludge removal, disinfection, and algae treatment. Ensures clean water storage.",
    category: "Plumbing",
    icon: "Tank",
    image: "https://images.unsplash.com/photo-1548832891-62084f76c0e7?auto=format&fit=crop&w=900&q=80",
    price: 2000,
    estimatedDuration: "2-4 hours",
    requirements: ["Tank access", "Water draining facility", "Manhole/opening available"]
  },
  {
    name: "Motor & Pump Repair",
    description: "Repair and installation of water motors, pressure pumps, and submersible pumps. Wiring check and motor efficiency restoration.",
    category: "Plumbing",
    icon: "Cog",
    image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
    price: 2500,
    estimatedDuration: "1-3 hours",
    requirements: ["Motor/pump accessible", "Power supply", "Water source if testing needed"]
  },

  // ===== CATEGORY 5: Automotive =====
  {
    name: "Car Washing",
    description: "Professional interior and exterior car washing with wax polish, tire cleaning, and dashboard polishing. Doorstep service available.",
    category: "Automotive",
    icon: "Car",
    image: "https://images.unsplash.com/photo-1601362840469-51e4d8d587ec?auto=format&fit=crop&w=900&q=80",
    price: 1200,
    estimatedDuration: "1-2 hours",
    requirements: ["Parking space", "Water supply", "Car accessible"]
  },
  {
    name: "Car AC Repair",
    description: "Vehicle air conditioning repair, gas refilling, compressor service, and cooling coil cleaning. Make your car AC cool like new.",
    category: "Automotive",
    icon: "Snowflake",
    image: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=900&q=80",
    price: 3000,
    estimatedDuration: "2-4 hours",
    requirements: ["Car available", "Power access", "Flat ground for work"]
  },
  {
    name: "Basic Car Maintenance",
    description: "Oil change, filter replacement, brake check, battery service, and general vehicle inspection. Keep your car running smoothly.",
    category: "Automotive",
    icon: "Gauge",
    image: "https://images.unsplash.com/photo-1487754180451-c456f719a1fc?auto=format&fit=crop&w=900&q=80",
    price: 4000,
    estimatedDuration: "2-4 hours",
    requirements: ["Car at workshop or home", "Service history if available", "Parts if specific needed"]
  },
  {
    name: "Two-Wheeler Service",
    description: "Motorcycle and scooter servicing including oil change, brake adjustment, chain cleaning, and general maintenance. Doorstep service.",
    category: "Automotive",
    icon: "Bike",
    image: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=900&q=80",
    price: 1500,
    estimatedDuration: "1-2 hours",
    requirements: ["Vehicle accessible", "Flat surface", "Oil disposal area"]
  },
  {
    name: "Jump Start & Battery",
    description: "Car battery jump start, battery replacement, and battery health check. Emergency roadside assistance for dead batteries.",
    category: "Automotive",
    icon: "Battery",
    image: "https://images.unsplash.com/photo-1619642367865-460f8e356220?auto=format&fit=crop&w=900&q=80",
    price: 800,
    estimatedDuration: "30-60 min",
    requirements: ["Vehicle location accessible", "New battery if replacement needed"]
  },

  // ===== CATEGORY 6: IT & Technical Support =====
  {
    name: "Computer Repair",
    description: "Hardware repair, software installation, virus removal, data recovery, and performance optimization for laptops and desktops.",
    category: "IT Support",
    icon: "Monitor",
    image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80",
    price: 2500,
    estimatedDuration: "1-4 hours",
    requirements: ["Device available", "Power supply", "Internet if needed", "Backup if data recovery"]
  },
  {
    name: "WiFi & Network Setup",
    description: "Router installation, WiFi configuration, range extension, and home network setup. Secure and fast internet connectivity solutions.",
    category: "IT Support",
    icon: "Wifi",
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=900&q=80",
    price: 1500,
    estimatedDuration: "1-2 hours",
    requirements: ["Router available", "Internet connection details", "Access to placement locations"]
  },
  {
    name: "CCTV Installation",
    description: "Security camera installation, configuration, and mobile viewing setup. Home and office surveillance solutions with proper cabling.",
    category: "IT Support",
    icon: "Camera",
    image: "https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=900&q=80",
    price: 5000,
    estimatedDuration: "2-6 hours",
    requirements: ["CCTV cameras available", "DVR/NVR available", "Power points near camera locations", "Monitor for setup"]
  },
  {
    name: "Printer Setup & Repair",
    description: "Printer installation, driver setup, cartridge replacement, and hardware repair. Wireless printing configuration included.",
    category: "IT Support",
    icon: "Printer",
    image: "https://images.unsplash.com/photo-1612815154858-60aa4c1d2e54?auto=format&fit=crop&w=900&q=80",
    price: 1200,
    estimatedDuration: "1-2 hours",
    requirements: ["Printer available", "USB cable or WiFi", "Cartridges if replacement needed", "Computer for driver installation"]
  },
  {
    name: "Smart Home Setup",
    description: "Smart device installation including smart lights, smart locks, Alexa/Google setup, and home automation configuration.",
    category: "IT Support",
    icon: "Home",
    image: "https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=900&q=80",
    price: 3000,
    estimatedDuration: "2-4 hours",
    requirements: ["Smart devices available", "WiFi credentials", "Mobile phone for app setup", "Power outlets"]
  }
];

// Categories with display info
export const CATEGORIES = [
  {
    name: "Cleaning",
    displayName: "Cleaning Services",
    icon: "Sparkles",
    color: "bg-emerald-500",
    description: "Home, office, and specialized cleaning solutions",
    image: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=600&q=80"
  },
  {
    name: "Home Repair",
    displayName: "Home Repair & Maintenance",
    icon: "Hammer",
    color: "bg-orange-500",
    description: "Carpentry, painting, and general repairs",
    image: "https://images.unsplash.com/photo-1581091870627-3d8b9d6c1b2d?auto=format&fit=crop&w=600&q=80"
  },
  {
    name: "Electrical",
    displayName: "Electrical & Electronics",
    icon: "Zap",
    color: "bg-amber-500",
    description: "Wiring, AC, and appliance services",
    image: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&w=600&q=80"
  },
  {
    name: "Plumbing",
    displayName: "Plumbing & Water",
    icon: "Droplets",
    color: "bg-blue-500",
    description: "Leak repair, drainage, and fittings",
    image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=600&q=80"
  },
  {
    name: "Automotive",
    displayName: "Automotive Services",
    icon: "Car",
    color: "bg-red-500",
    description: "Car and two-wheeler maintenance",
    image: "https://images.unsplash.com/photo-1601362840469-51e4d8d587ec?auto=format&fit=crop&w=600&q=80"
  },
  {
    name: "IT Support",
    displayName: "IT & Technical Support",
    icon: "Monitor",
    color: "bg-purple-500",
    description: "Computer, network, and smart home setup",
    image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=80"
  }
];
