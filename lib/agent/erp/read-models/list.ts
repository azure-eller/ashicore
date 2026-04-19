import type { InsertCustomerCategory, UpdateCustomerCategory } from "@/lib/schemas/customer-categories";
import type { InsertCustomer, UpdateCustomer } from "@/lib/schemas/customers";
import type {
  InsertManufacturingOrder,
  UpdateManufacturingOrder,
} from "@/lib/schemas/manufacturing-orders";
import type {
  InsertPurchaseOrder,
  UpdatePurchaseOrder,
} from "@/lib/schemas/purchase-orders";
import type {
  InsertSalesOrder,
  UpdateSalesOrder,
} from "@/lib/schemas/sales-orders";
import type { InsertSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";
import {
  createCustomerCategoryForAgent,
  createCustomerForAgent,
  getCustomerCategoryForAgent,
  getCustomerForAgent,
  listCustomerCategoriesForAgent,
  listCustomersForAgent,
  updateCustomerCategoryForAgent,
  updateCustomerForAgent,
} from "@/lib/agent/erp/read-models/customer";
import { getItemForAgent, listItemsForAgent } from "@/lib/agent/erp/read-models/item";
import {
  createManufacturingOrderForAgent,
  getManufacturingOrderForAgent,
  listManufacturingOrdersForAgent,
  updateManufacturingOrderForAgent,
} from "@/lib/agent/erp/read-models/manufacturing-order";
import {
  createPurchaseOrderForAgent,
  getPurchaseOrderForAgent,
  listPurchaseOrdersForAgent,
  updatePurchaseOrderForAgent,
} from "@/lib/agent/erp/read-models/purchase-order";
import {
  createSalesOrderForAgent,
  getSalesOrderForAgent,
  listSalesOrdersForAgent,
  updateSalesOrderForAgent,
} from "@/lib/agent/erp/read-models/sales-order";
import { getStocktakeForAgent, listStocktakesForAgent } from "@/lib/agent/erp/read-models/stocktake";
import {
  createSupplierForAgent,
  getSupplierForAgent,
  listSuppliersForAgent,
  updateSupplierForAgent,
} from "@/lib/agent/erp/read-models/supplier";
import type { ErpEntityType, ErpGetOutput, ErpListOutput, ErpWriteEntityType } from "@/lib/agent/erp/read-models/types";

export async function getEntityForAgent(args: {
  entityType: ErpEntityType;
  id: string;
}): Promise<ErpGetOutput | null> {
  switch (args.entityType) {
    case "customer":
      return getCustomerForAgent(args.id);
    case "customer_category":
      return getCustomerCategoryForAgent(args.id);
    case "supplier":
      return getSupplierForAgent(args.id);
    case "item":
      return getItemForAgent(args.id);
    case "sales_order":
      return getSalesOrderForAgent(args.id);
    case "purchase_order":
      return getPurchaseOrderForAgent(args.id);
    case "manufacturing_order":
      return getManufacturingOrderForAgent(args.id);
    case "stocktake":
      return getStocktakeForAgent(args.id);
  }
}

export async function listEntityForAgent(args:
  | {
      entityType: "customer";
      limit: number;
      offset: number;
      search?: string;
      activeOnly?: boolean;
    }
  | {
      entityType: "customer_category";
      limit: number;
      offset: number;
      search?: string;
    }
  | {
      entityType: "supplier";
      limit: number;
      offset: number;
      search?: string;
      activeOnly?: boolean;
    }
  | {
      entityType: "item";
      limit: number;
      offset: number;
      search?: string;
      itemType?: "material" | "product";
      view?: "products" | "sub-assemblies";
    }
  | {
      entityType: "sales_order";
      limit: number;
      offset: number;
      search?: string;
      status?: string[];
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  | {
      entityType: "purchase_order";
      limit: number;
      offset: number;
      search?: string;
      status?: string[];
      supplierId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  | {
      entityType: "manufacturing_order";
      limit: number;
      offset: number;
      search?: string;
      status?: string[];
      productId?: string;
    }
  | {
      entityType: "stocktake";
      limit: number;
      offset: number;
      search?: string;
      status?: string[];
    }
): Promise<ErpListOutput> {
  switch (args.entityType) {
    case "customer":
      return listCustomersForAgent(args);
    case "customer_category":
      return listCustomerCategoriesForAgent(args);
    case "supplier":
      return listSuppliersForAgent(args);
    case "item":
      return listItemsForAgent(args);
    case "sales_order":
      return listSalesOrdersForAgent(args);
    case "purchase_order":
      return listPurchaseOrdersForAgent(args);
    case "manufacturing_order":
      return listManufacturingOrdersForAgent(args);
    case "stocktake":
      return listStocktakesForAgent(args);
  }
}

export async function createEntityForAgent(args:
  | {
      entityType: "customer";
      values: InsertCustomer;
    }
  | {
      entityType: "customer_category";
      values: InsertCustomerCategory;
    }
  | {
      entityType: "supplier";
      values: InsertSupplier;
    }
  | {
      entityType: "sales_order";
      values: InsertSalesOrder;
    }
  | {
      entityType: "purchase_order";
      values: InsertPurchaseOrder;
    }
  | {
      entityType: "manufacturing_order";
      values: InsertManufacturingOrder;
    }
): Promise<ErpGetOutput> {
  switch (args.entityType) {
    case "customer":
      return createCustomerForAgent(args.values);
    case "customer_category":
      return createCustomerCategoryForAgent(args.values);
    case "supplier":
      return createSupplierForAgent(args.values);
    case "sales_order":
      return createSalesOrderForAgent(args.values);
    case "purchase_order":
      return createPurchaseOrderForAgent(args.values);
    case "manufacturing_order":
      return createManufacturingOrderForAgent(args.values);
  }
}

export async function updateEntityForAgent(args:
  | {
      entityType: "customer";
      id: string;
      values: UpdateCustomer;
    }
  | {
      entityType: "customer_category";
      id: string;
      values: UpdateCustomerCategory;
    }
  | {
      entityType: "supplier";
      id: string;
      values: UpdateSupplier;
    }
  | {
      entityType: "sales_order";
      id: string;
      values: UpdateSalesOrder;
    }
  | {
      entityType: "purchase_order";
      id: string;
      values: UpdatePurchaseOrder;
    }
  | {
      entityType: "manufacturing_order";
      id: string;
      values: UpdateManufacturingOrder;
    }
): Promise<ErpGetOutput | null> {
  switch (args.entityType) {
    case "customer":
      return updateCustomerForAgent(args.id, args.values);
    case "customer_category":
      return updateCustomerCategoryForAgent(args.id, args.values);
    case "supplier":
      return updateSupplierForAgent(args.id, args.values);
    case "sales_order":
      return updateSalesOrderForAgent(args.id, args.values);
    case "purchase_order":
      return updatePurchaseOrderForAgent(args.id, args.values);
    case "manufacturing_order":
      return updateManufacturingOrderForAgent(args.id, args.values);
  }
}

export function isEntityWritable(entityType: ErpEntityType): entityType is ErpWriteEntityType {
  return (
    entityType === "customer" ||
    entityType === "customer_category" ||
    entityType === "supplier" ||
    entityType === "sales_order" ||
    entityType === "purchase_order" ||
    entityType === "manufacturing_order"
  );
}
