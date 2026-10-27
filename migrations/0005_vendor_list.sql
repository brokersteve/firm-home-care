-- F.I.R.M.'s vendor list (Vendor Contact List, 10/26/2026). Billing, utility and listing accounts on that list
-- (Account Adjustment, Charlotte Meck Utilities, Duke Energy, EcoCare, FIRM, Online CC Payment, SocialServe,
-- WLB Accounting) aren't repair vendors, so they're left out. All Maintenance Group is the same company as Real
-- Creative Maintenance (Steve, 2026-10-27), so it isn't listed twice. Staff can add or edit vendors on the Vendors page.
ALTER TABLE vendors ADD COLUMN contact TEXT;       -- person to ask for
ALTER TABLE vendors ADD COLUMN office_phone TEXT;  -- a landline: shown for calling, never texted

-- Real Creative Maintenance answers F.I.R.M.'s emergency line.
UPDATE vendors SET name = 'Real Creative Maintenance', trade = 'In-house maintenance', phone = '704-430-6193'
  WHERE name = 'F.I.R.M. Maintenance';

INSERT INTO vendors (name, contact, trade, email, phone, office_phone) VALUES
  ('A-1 Wildlife Control', 'Allen Eckman', 'Wildlife', 'a1wildlifecontrol@gmail.com', NULL, '704-334-1922'),
  ('Admiring Painting Services', 'Mayra Herrera', 'Painting', 'mayraherrerajuarez@gmail.com', NULL, NULL),
  ('Appliance Medic', 'Gabby', 'Appliances', 'appliancemedic2013@gmail.com', NULL, '704-659-1871'),
  ('Boss Handyman Services, LLC', 'Frank Benton', 'Handyman', 'bosshandyman2025@gmail.com', '704-808-1845', NULL),
  ('BV Building Solutions, LLC', 'Brandon Laffin', 'Construction', 'brandon@bvbuildingsolutions.com', '845-214-8556', '845-214-8556'),
  ('Carolina Appliance Service, LLC', 'Robert Pfefferie', 'Appliances', 'pef2500@yahoo.com', '704-537-6406', NULL),
  ('Champion Residential Services, LLC', 'Morris Jenkins', NULL, NULL, NULL, NULL),
  ('Dale Diano Builders Inc', 'Randy Wyatt', 'Construction', 'daledianobuilders2022@yahoo.com', '704-737-5841', NULL),
  ('DB Mechanical Heating and Cooling, LLC', 'Dave Barch', 'HVAC', 'dbarch83@gmail.com', '704-777-9981', NULL),
  ('Discount Garage Door Service, LLC', 'Patrick Keen', 'Garage doors', 'dgds2017@icloud.com', NULL, NULL),
  ('Garage Door Doctor (GFHGDD, LLC)', NULL, 'Garage doors', 'accounting@garagedoordoctor.com', NULL, '704-705-8444'),
  ('Greenville Construction, LLC', NULL, 'Construction', 'support@greenvilleconstruction.net', NULL, '864-990-3166'),
  ('Josh T', 'Josh T', NULL, 'joshua.kalish@gmail.com', '704-999-8908', NULL),
  ('Moe Heating and Air, LLC', NULL, 'HVAC', 'moeheatingandairhvac@gmail.com', '704-835-5845', NULL),
  ('Sherrill''s Concrete and Lawn Service', 'Darby Sherrill', 'Concrete and lawn', 'darbysher14@gmail.com', '704-747-8710', NULL),
  ('Sparkle McNair', NULL, NULL, 'sparkmcna2000@yahoo.com', NULL, NULL),
  ('The Appliance Repair Professionals', NULL, 'Appliances', 'enoc.repairprofessionals@gmail.com', NULL, '855-476-9978'),
  ('Transparent Maintenance', 'Caleb Benton', 'Maintenance', 'wo@transparentmaintenance.com', '979-308-5838', NULL);
