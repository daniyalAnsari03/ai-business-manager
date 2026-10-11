import { register } from "node:module";

// Tools tests replace sessions, business service, approval outbound channels
// and the customers/orders/suppliers/supplier-bills/payments READ services;
// the approval service, executors, service-role wrapper, audit writer and the
// AI tools themselves all stay real.
register(new URL("./hooks-tools.mjs", import.meta.url));