import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  output: "static",
  site: "https://ashicore.app",
  redirects: {
    "/docs/admin/integrations": "/docs/",
    "/docs/admin/setup": "/docs/purchasing/manage-suppliers",
    "/docs/concepts/allocations": "/docs/",
    "/docs/concepts/inventory": "/docs/",
    "/docs/concepts/manufacturing-orders": "/docs/",
    "/docs/concepts/planned-vs-unplanned-demand": "/docs/",
    "/docs/design-decisions/why-delete-instead-of-cancel": "/docs/purchasing/the-po-lifecycle",
    "/docs/design-decisions/why-workflow-first": "/docs/",
    "/docs/developer/architecture": "/docs/",
    "/docs/developer/invariants": "/docs/",
    "/docs/developer/testing": "/docs/",
    "/docs/how-to/allocate-stock": "/docs/",
    "/docs/how-to/complete-manufacturing-order": "/docs/",
    "/docs/how-to/create-batch-recipe": "/docs/",
    "/docs/how-to/delete-a-purchase-order": "/docs/purchasing/the-po-lifecycle",
    "/docs/how-to/receive-inventory": "/docs/purchasing/receive-stock",
    "/docs/how-to/split-a-shipment": "/docs/purchasing/add-shipping-and-customs",
    "/docs/reference/allocation-rules": "/docs/",
    "/docs/reference/api-reference": "/docs/",
    "/docs/reference/delete-rules": "/docs/purchasing/the-po-lifecycle",
    "/docs/reference/inventory-statuses": "/docs/",
    "/docs/reference/purchase-order-statuses": "/docs/purchasing/purchase-order-fields",
    "/docs/start-here/erp-overview": "/docs/",
    "/docs/start-here/first-inventory-workflow": "/docs/",
    "/docs/start-here/first-manufacturing-workflow": "/docs/",
    "/docs/start-here/first-sales-workflow": "/docs/",
  },
  integrations: [
    starlight({
      title: "Ashicore Docs",
      // Keep the marketing brand 404 (src/pages/404.astro) site-wide.
      disable404Route: true,
      customCss: ["./src/styles/starlight.css"],
      head: [
        // Default the docs to light mode for first-time visitors; the theme
        // toggle still works and is remembered after that.
        {
          tag: "script",
          content:
            "try{if(!localStorage.getItem('starlight-theme'))localStorage.setItem('starlight-theme','light')}catch(e){}",
        },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: true } },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
          },
        },
      ],
      // Docs are served under /docs via the nested src/content/docs/docs/ directory.
      // The marketing site keeps src/pages/index.astro, /pricing, etc.
      sidebar: [
        {
          label: "Purchasing",
          items: [
            { label: "Overview", link: "/docs/purchasing/" },
            {
              label: "How-tos",
              items: [
                { label: "Create a purchase order", link: "/docs/purchasing/create-a-purchase-order" },
                { label: "Order from supplier", link: "/docs/purchasing/submit-to-your-supplier" },
                { label: "Receive stock", link: "/docs/purchasing/receive-stock" },
                { label: "Add shipping & customs", link: "/docs/purchasing/add-shipping-and-customs" },
                { label: "Sync a supplier bill", link: "/docs/purchasing/sync-a-bill-to-xero" },
                { label: "Manage suppliers", link: "/docs/purchasing/manage-suppliers" },
              ],
            },
            {
              label: "Concepts",
              items: [
                { label: "The purchase order lifecycle", link: "/docs/purchasing/the-po-lifecycle" },
                { label: "Purchase vs. stock units", link: "/docs/purchasing/purchase-vs-stock-units" },
                { label: "Landed & additional costs", link: "/docs/purchasing/landed-and-additional-costs" },
                { label: "Expected supply", link: "/docs/purchasing/expected-supply" },
                { label: "Lots & receiving", link: "/docs/purchasing/lots-and-receiving" },
                { label: "Snapshots", link: "/docs/purchasing/snapshots" },
              ],
            },
            {
              label: "Reference",
              items: [
                { label: "Purchase order fields", link: "/docs/purchasing/purchase-order-fields" },
              ],
            },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
