import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  output: "static",
  site: "https://ashicore.app",
  redirects: {
    "/docs/admin/integrations": "/docs/",
    "/docs/admin/setup": "/docs/purchasing/suppliers",
    "/docs/concepts/allocations": "/docs/",
    "/docs/concepts/inventory": "/docs/inventory/",
    "/docs/concepts/manufacturing-orders": "/docs/manufacturing/manufacturing-orders",
    "/docs/concepts/planned-vs-unplanned-demand": "/docs/",
    "/docs/design-decisions/why-delete-instead-of-cancel": "/docs/purchasing/the-po-lifecycle",
    "/docs/design-decisions/why-workflow-first": "/docs/",
    "/docs/developer/architecture": "/docs/",
    "/docs/developer/invariants": "/docs/",
    "/docs/developer/testing": "/docs/",
    "/docs/how-to/allocate-stock": "/docs/sales/fulfillment-and-allocation",
    "/docs/how-to/complete-manufacturing-order": "/docs/manufacturing/complete-and-record-output",
    "/docs/how-to/create-batch-recipe": "/docs/manufacturing/build-a-recipe",
    "/docs/how-to/delete-a-purchase-order": "/docs/purchasing/the-po-lifecycle",
    "/docs/how-to/receive-inventory": "/docs/purchasing/receive-stock",
    "/docs/how-to/split-a-shipment": "/docs/purchasing/add-shipping-and-customs",
    "/docs/purchasing/manage-suppliers": "/docs/purchasing/suppliers",
    "/docs/reference/allocation-rules": "/docs/",
    "/docs/reference/api-reference": "/docs/",
    "/docs/reference/delete-rules": "/docs/purchasing/the-po-lifecycle",
    "/docs/reference/inventory-statuses": "/docs/inventory/event-types-and-dispositions",
    "/docs/reference/purchase-order-statuses": "/docs/purchasing/purchase-order-fields",
    "/docs/start-here/erp-overview": "/docs/",
    "/docs/start-here/first-inventory-workflow": "/docs/inventory/",
    "/docs/start-here/first-manufacturing-workflow": "/docs/manufacturing/",
    "/docs/start-here/first-sales-workflow": "/docs/sales/",
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
          label: "Start",
          items: [
            { label: "Welcome", link: "/docs/start/welcome" },
            { label: "Import your data", link: "/docs/start/importing-data" },
          ],
        },
        {
          label: "Inventory",
          collapsed: true,
          items: [
            { label: "Overview", link: "/docs/inventory/" },
            {
              label: "Items",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/inventory/items" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Add a product or material", link: "/docs/inventory/add-a-product-or-material" },
                  ],
                },
                {
                  label: "Concepts",
                  collapsed: true,
                  items: [
                    { label: "Product variants & families", link: "/docs/inventory/product-variants-and-families" },
                    { label: "Purchase vs. stock units", link: "/docs/purchasing/purchase-vs-stock-units" },
                  ],
                },
                {
                  label: "Reference",
                  collapsed: true,
                  items: [
                    { label: "Item fields", link: "/docs/inventory/item-fields" },
                  ],
                },
              ],
            },
            {
              label: "Stock & lots",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/inventory/stock-and-lots" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Adjust stock", link: "/docs/inventory/adjust-stock" },
                    { label: "Block, release & scrap", link: "/docs/inventory/block-release-and-scrap" },
                    { label: "Transfers", link: "/docs/inventory/transfers" },
                  ],
                },
                {
                  label: "Concepts",
                  collapsed: true,
                  items: [
                    { label: "The inventory ledger", link: "/docs/inventory/ledger" },
                    { label: "On-hand, demand & ATP", link: "/docs/inventory/on-hand-demand-and-atp" },
                  ],
                },
                {
                  label: "Reference",
                  collapsed: true,
                  items: [
                    { label: "Event types & dispositions", link: "/docs/inventory/event-types-and-dispositions" },
                  ],
                },
              ],
            },
            {
              label: "Stocktakes",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/inventory/stocktakes" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Run a stocktake", link: "/docs/inventory/run-a-stocktake" },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: "Sales",
          collapsed: true,
          items: [
            { label: "Overview", link: "/docs/sales/" },
            {
              label: "Sales orders",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/sales/sales-orders" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Create a sales order", link: "/docs/sales/create-a-sales-order" },
                    { label: "Deliver & invoice", link: "/docs/sales/deliver-and-invoice" },
                    { label: "Make to order", link: "/docs/sales/make-to-order" },
                  ],
                },
                {
                  label: "Concepts",
                  collapsed: true,
                  items: [
                    { label: "The delivery lifecycle", link: "/docs/sales/the-delivery-lifecycle" },
                    { label: "Fulfillment & allocation", link: "/docs/sales/fulfillment-and-allocation" },
                    { label: "Pricing, discounts & margin", link: "/docs/sales/pricing-discounts-and-margin" },
                  ],
                },
                {
                  label: "Reference",
                  collapsed: true,
                  items: [
                    { label: "Sales order fields", link: "/docs/sales/sales-order-fields" },
                  ],
                },
              ],
            },
            {
              label: "Customers",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/sales/customers" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Add a customer", link: "/docs/sales/add-a-customer" },
                    { label: "Contacts, activity & tasks", link: "/docs/sales/contacts-activity-and-tasks" },
                  ],
                },
                {
                  label: "Concepts",
                  collapsed: true,
                  items: [
                    { label: "Account state & priority", link: "/docs/sales/account-state-and-priority" },
                  ],
                },
                {
                  label: "Reference",
                  collapsed: true,
                  items: [
                    { label: "Customer fields", link: "/docs/sales/customer-fields" },
                  ],
                },
              ],
            },
            {
              label: "Pricing schedules",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/sales/pricing-schedules" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Build a pricing schedule", link: "/docs/sales/build-a-pricing-schedule" },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: "Purchasing",
          collapsed: true,
          items: [
            { label: "Overview", link: "/docs/purchasing/" },
            {
              label: "Purchase orders",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/purchasing/purchase-orders" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Create a purchase order", link: "/docs/purchasing/create-a-purchase-order" },
                    { label: "Order from supplier", link: "/docs/purchasing/submit-to-your-supplier" },
                    { label: "Receive stock", link: "/docs/purchasing/receive-stock" },
                    { label: "Add shipping & customs", link: "/docs/purchasing/add-shipping-and-customs" },
                    { label: "Sync a bill to Xero", link: "/docs/purchasing/sync-a-bill-to-xero" },
                  ],
                },
                {
                  label: "Concepts",
                  collapsed: true,
                  items: [
                    { label: "The PO lifecycle", link: "/docs/purchasing/the-po-lifecycle" },
                    { label: "Purchase vs. stock units", link: "/docs/purchasing/purchase-vs-stock-units" },
                    { label: "Landed & additional costs", link: "/docs/purchasing/landed-and-additional-costs" },
                    { label: "Expected supply", link: "/docs/purchasing/expected-supply" },
                    { label: "Lots & receiving", link: "/docs/purchasing/lots-and-receiving" },
                    { label: "Snapshots", link: "/docs/purchasing/snapshots" },
                  ],
                },
                {
                  label: "Reference",
                  collapsed: true,
                  items: [
                    { label: "Purchase order fields", link: "/docs/purchasing/purchase-order-fields" },
                  ],
                },
              ],
            },
            { label: "Suppliers", link: "/docs/purchasing/suppliers" },
          ],
        },
        {
          label: "Manufacturing",
          collapsed: true,
          items: [
            { label: "Overview", link: "/docs/manufacturing/" },
            {
              label: "Manufacturing orders",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/manufacturing/manufacturing-orders" },
                {
                  label: "How-tos",
                  collapsed: true,
                  items: [
                    { label: "Create an order", link: "/docs/manufacturing/create-a-manufacturing-order" },
                    { label: "Start & track production", link: "/docs/manufacturing/start-and-track-production" },
                    { label: "Complete & record output", link: "/docs/manufacturing/complete-and-record-output" },
                    { label: "Prioritize the queue", link: "/docs/manufacturing/prioritize-the-queue" },
                  ],
                },
                {
                  label: "Concepts",
                  collapsed: true,
                  items: [
                    { label: "The production lifecycle", link: "/docs/manufacturing/the-production-lifecycle" },
                    { label: "Discrete & batch production", link: "/docs/manufacturing/discrete-and-batch-production" },
                    { label: "Ingredients & picking", link: "/docs/manufacturing/ingredients-and-picking" },
                    { label: "Output, lots & cost", link: "/docs/manufacturing/output-lots-and-cost" },
                  ],
                },
                {
                  label: "Reference",
                  collapsed: true,
                  items: [
                    { label: "Manufacturing order fields", link: "/docs/manufacturing/manufacturing-order-fields" },
                  ],
                },
              ],
            },
            {
              label: "Bills of materials",
              collapsed: true,
              items: [
                { label: "Overview", link: "/docs/manufacturing/bills-of-materials" },
                { label: "Build a recipe", link: "/docs/manufacturing/build-a-recipe" },
                { label: "Revisions & locking", link: "/docs/manufacturing/bom-revisions-and-locking" },
              ],
            },
            { label: "Resources", link: "/docs/manufacturing/resources" },
          ],
        },
        {
          label: "Integrations",
          collapsed: true,
          items: [
            { label: "Overview", link: "/docs/integrations/" },
            { label: "Accounting sync", link: "/docs/integrations/accounting-sync" },
            { label: "Shopify orders", link: "/docs/integrations/shopify" },
            { label: "Agent API", link: "/docs/integrations/agent-api" },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
