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
  /** The office cell: emergency work orders are texted here at any hour. Empty = email only. */
  OFFICE_CELL: string;
  /** Jobs expected to cost more than this need the owner's OK first (dollars). A home can have its own limit. */
  OWNER_APPROVAL_LIMIT: string;
  /** Rentec priority (1 to 5) for emergency, urgent, routine and tenant-responsibility work orders, e.g. "1,2,3,3". */
  RENTEC_PRIORITIES: string;
  /** Local time zone for text quiet hours, e.g. America/New_York. */
  TIMEZONE: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  /** The Twilio number texts come from, as +1XXXXXXXXXX. */
  TWILIO_FROM: string;
  /** F.I.R.M.'s public website, linked from the app's sign-in page. */
  WEBSITE_URL: string;
  /** The phone app's ID in both stores, e.g. vip.firm.app. */
  APP_ID: string;
  /** Apple Developer Team ID; with it, email links open in the iPhone app. Empty = off. */
  APPLE_TEAM_ID: string;
  /** SHA-256 fingerprint(s) of the Android signing key (Play Console > App integrity). Empty = off. */
  ANDROID_CERT_SHA256: string;
  /** Firebase service account JSON for push notifications. Empty = no push. "log" prints pushes instead. */
  FCM_SERVICE_ACCOUNT: string;
  /** A test tenant's email and fixed code for Apple and Google app review. Empty = off. */
  APP_REVIEW_EMAIL: string;
  APP_REVIEW_CODE: string;
}

/** A property's home details by "HC ..." name, kept in its Rentec sticky note. */
export type PropertyFields = Record<string, string>;

export interface Property {
  id: string;
  name: string;
  address: string;
  fields: PropertyFields;
  /** This owner's approval limit, when it differs from OWNER_APPROVAL_LIMIT. Set in Home Care, not Rentec. */
  approval_limit?: number | null;
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
