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
  RENTEC_API_KEY: string;
  RESEND_API_KEY: string;
  LINK_SECRET: string;
  ADMIN_TOKEN: string;
}

/** The "HC ..." custom fields F.I.R.M. keeps on each Rentec property. */
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
  move_in: string | null;
  move_out: string | null;
  insurance_expires: string | null;
  active: number;
}
