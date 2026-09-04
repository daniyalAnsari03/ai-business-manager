import { register } from "node:module";

// Dedicated register entry so the ad-campaign tool test can stub the service
// layer (getProducts / getMetaAdsConnection) and exercise the tool's HONEST
// not-connected + connected-stub branches offline, without any Supabase call.
register(new URL("./ad-campaign-module-hooks.mjs", import.meta.url));
