export const SHOPIFY_PROVIDER = "shopify";
export const SHOPIFY_API_VERSION = "2025-10";

export type ShopifyConnectionSettings = {
  shopDomain?: string;
};

export type ShopifyAddress = {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
};

export type ShopifyCustomer = {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type ShopifyOrderLine = {
  id: number | string;
  sku?: string | null;
  title?: string | null;
  quantity?: number | string | null;
  fulfillable_quantity?: number | string | null;
  price?: string | null;
};

export type ShopifyOrder = {
  id: number | string;
  name?: string | null;
  order_number?: number | string | null;
  created_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  line_items?: ShopifyOrderLine[];
};

export type ShopifyOrdersResponse = {
  orders?: ShopifyOrder[];
};

