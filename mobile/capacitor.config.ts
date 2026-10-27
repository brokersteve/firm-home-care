import type { CapacitorConfig } from "@capacitor/cli";

// The app opens F.I.R.M. Home Care (the Cloudflare Worker in ../src) at /app, so tenants see the same pages as
// on the web and changes go live without a store update. Set FIRM_APP_URL to try it against another server,
// e.g. FIRM_APP_URL=http://10.0.2.2:8787 for `wrangler dev` from the Android emulator.
const site = process.env.FIRM_APP_URL ?? "https://home.firm.vip";

const config: CapacitorConfig = {
  appId: "vip.firm.app",
  appName: "FIRM",
  webDir: "www",
  // The Worker checks for this to keep tenants signed in on their phone (src/app.ts).
  appendUserAgent: "FIRMApp/1",
  backgroundColor: "#1f5f8b",
  server: {
    url: `${site}/app`,
    cleartext: site.startsWith("http://"),
    // No signal: show the emergency line and water shutoff steps that ship inside the app.
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "always",
    scheme: "FIRM",
  },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: "#1f5f8b", showSpinner: false },
    FirebaseMessaging: { presentationOptions: ["alert", "badge", "sound"] },
  },
  experimental: {
    ios: { spm: { packageOptions: { "@capacitor-firebase/messaging": { symlink: true } } } },
  },
};

export default config;
