// The demo home: a made-up tenant and house that anyone can open from the app's sign-in page ("Try the demo"),
// so staff and app store reviewers can look around without a real tenant. It lives only in this file: it is
// never written to Rentec or the database, never gets reminders, and nothing done in it is saved or sent.
import type { Property, Tenant } from "./env";

export const DEMO_ID = "demo";

export const isDemo = (id: string | undefined | null) => id === DEMO_ID;

export const DEMO_TENANT: Tenant = {
  id: DEMO_ID,
  property_id: DEMO_ID,
  first_name: "there",
  last_name: "(demo)",
  // Sample contact details, so the work order form shows them filled in.
  email: "demo@example.com",
  phone: "704-555-0100",
  move_in: null,
  move_out: null,
  insurance_expires: null,
  active: 1,
};

export const DEMO_PROPERTY: Property = {
  id: DEMO_ID,
  name: "Demo home",
  address: "Demo home with sample details (not a real address)",
  fields: {
    "HC Filter 1 Size": "16x25x1",
    "HC Filter 1 Location": "Hallway ceiling return vent",
    "HC Filter 2 Size": "20x20x1",
    "HC Filter 2 Location": "Upstairs hall return vent",
    "HC Filter Months": "2",
    "HC Smoke Detectors": "5",
    "HC CO Detectors": "1",
    "HC Water Shutoff": "Crawl space entry, left of the water heater",
    "HC Gas Shutoff": "At the meter, right side of the house",
    "HC Breaker Panel": "Garage, left wall",
    "HC Heat Type": "Gas furnace",
    "HC Water Heater": "Gas tank",
    "HC Disposal Wrench": "Taped inside the sink cabinet door",
    "HC Trash Day": "Tuesday; recycling every other Tuesday",
    "HC Utilities": "Duke Energy (electric), Charlotte Water, Piedmont Natural Gas",
    "HC Local Notes": "Mailbox is number 12 at the cluster box by the entrance.",
  },
};
