export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  COMPANY_NAME: string;
  APP_URL: string;
  RENTEC_BASE_URL: string;
  EMAIL_FROM: string;
  EMERGENCY_PHONE: string;
  RESIDENT_CONNECT_URL: string;
  PILOT_PROPERTY_IDS: string;
  /** The pilot homes by address, separated by ";". Used alongside PILOT_PROPERTY_IDS. */
  PILOT_ADDRESSES: string;
  RENTEC_API_KEY: string;
  RESEND_API_KEY: string;
  LINK_SECRET: string;
  ADMIN_TOKEN: string;
  /** Where "sent to vendor" confirmations go, e.g. steve@firm.vip. */
  OFFICE_EMAIL: string;
  /** Local time zone for text quiet hours, e.g. America/New_York. */
  TIMEZONE: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  /** The Twilio number texts come from, as +1XXXXXXXXXX. */
  TWILIO_FROM: string;
}

/** A property's home details by "HC ..." name, kept in its Rentec sticky note. */
export type PropertyFields = Record<string, string>;

export interface Property {
  id: string;
  name: string;
  address: string;
  fields: PropertyFields;
}

export interface Tenant {
  id: string;
  property_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  move_in: string | null;
  move_out: string | null;
  insurance_expires: string | null;
  active: number;
}
