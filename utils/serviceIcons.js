/** Auto-select Lucide icon name for a service from its title/category */
const ICON_RULES = [
  { test: /clean|maid|wash/i, icon: "Sparkles" },
  { test: /plumb|pipe|drain|water|faucet/i, icon: "Droplets" },
  { test: /electric|wiring|volt|power/i, icon: "Zap" },
  { test: /car|auto|vehicle|mechanic/i, icon: "Car" },
  { test: /paint|wall/i, icon: "Paintbrush" },
  { test: /carpent|wood|furniture/i, icon: "Hammer" },
  { test: /hvac|ac |air condition|cooling|heating|fan/i, icon: "Wind" },
  { test: /appliance|fridge|oven|washer/i, icon: "Lightbulb" },
  { test: /it |computer|laptop|network|software/i, icon: "Cpu" },
  { test: /repair|fix|maintain|handyman/i, icon: "Wrench" },
  { test: /garden|lawn|landscape/i, icon: "Leaf" },
  { test: /security|lock|cctv/i, icon: "Shield" },
  { test: /moving|shift|relocate/i, icon: "Truck" },
  { test: /pest|fumigat/i, icon: "Bug" },
  { test: /roof|tile/i, icon: "Home" },
];

export const SERVICE_ICON_OPTIONS = [
  "Wrench",
  "Zap",
  "Droplets",
  "Car",
  "Hammer",
  "Paintbrush",
  "Wind",
  "Lightbulb",
  "Cpu",
  "Home",
  "Settings",
  "Sparkles",
  "Building2",
  "Shield",
  "Truck",
  "Leaf",
  "Bug",
];

export const DEFAULT_SERVICE_ICON = "Wrench";

export function pickServiceIcon(name = "", category = "") {
  const text = `${name} ${category}`.trim();
  if (!text) return DEFAULT_SERVICE_ICON;
  for (const rule of ICON_RULES) {
    if (rule.test.test(text)) return rule.icon;
  }
  return DEFAULT_SERVICE_ICON;
}
