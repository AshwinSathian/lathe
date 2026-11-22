// Turns on the app's test hook before any page script runs. Production visitors never set this flag.
import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => { (window as any).__latheTest = true; });
    await use(context);
  },
});
