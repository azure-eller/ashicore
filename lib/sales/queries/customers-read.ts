import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeMoney } from "@/lib/format";
import { customerActivities, customerCategories, customerContacts, customerProjects, customers, integrationExternalRecords, salesOrders } from "@/lib/db/schema";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { documentNumberSortSql } from "@/lib/document-numbers";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type { CustomerDetailData, CustomerProjectRow, CustomerOption, CustomerRow, SalesOrderListRow } from "../types";
import { parseMoneyValue } from "./shared";
import { getCustomerActivitiesInTx, getCustomerContactsInTx, getCustomerProjectsInTx } from "./crm";

const customerRowSelect = {
  id: customers.id,
  name: customers.name,
  customerCategoryId: customers.customerCategoryId,
  customerCategoryName: customerCategories.name,
  accountState: customers.accountState,
  accountPriority: customers.accountPriority,
  openOrderCount: sql<number>`(
    SELECT COUNT(*)::int
    FROM sales.sales_orders so
    WHERE so.customer_id = ${customers.id}
      AND so.deleted_at IS NULL
      AND so.status = 'open'
  )`.as("openOrderCount"),
  openOrderValue: trimScale(sql`COALESCE((
    SELECT SUM(so.total_amount)
    FROM sales.sales_orders so
    WHERE so.customer_id = ${customers.id}
      AND so.deleted_at IS NULL
      AND so.status = 'open'
  ), 0)`).as("openOrderValue"),
  latestOrderDate: sql<string | null>`(
    SELECT MAX(so.order_date)::text
    FROM sales.sales_orders so
    WHERE so.customer_id = ${customers.id}
      AND so.deleted_at IS NULL
  )`.as("latestOrderDate"),
  email: customers.email,
  phone: customers.phone,
  primaryContactName: sql<string | null>`(
    SELECT cc.name
    FROM ${customerContacts} cc
    WHERE cc.customer_id = ${customers.id}
      AND cc.deleted_at IS NULL
      AND cc.is_primary = true
    ORDER BY cc.created_at ASC, cc.name ASC
    LIMIT 1
  )`.as("primaryContactName"),
  primaryContactEmail: sql<string | null>`(
    SELECT cc.email
    FROM ${customerContacts} cc
    WHERE cc.customer_id = ${customers.id}
      AND cc.deleted_at IS NULL
      AND cc.is_primary = true
    ORDER BY cc.created_at ASC, cc.name ASC
    LIMIT 1
  )`.as("primaryContactEmail"),
  primaryContactPhone: sql<string | null>`(
    SELECT cc.phone
    FROM ${customerContacts} cc
    WHERE cc.customer_id = ${customers.id}
      AND cc.deleted_at IS NULL
      AND cc.is_primary = true
    ORDER BY cc.created_at ASC, cc.name ASC
    LIMIT 1
  )`.as("primaryContactPhone"),
  billingLine1: customers.billingLine1,
  billingLine2: customers.billingLine2,
  billingCity: customers.billingCity,
  billingRegion: customers.billingRegion,
  billingPostcode: customers.billingPostcode,
  billingCountry: customers.billingCountry,
  shipLine1: customers.shipLine1,
  shipLine2: customers.shipLine2,
  shipCity: customers.shipCity,
  shipRegion: customers.shipRegion,
  shipPostcode: customers.shipPostcode,
  shipCountry: customers.shipCountry,
  xeroContactId: sql<string | null>`(
    SELECT ${integrationExternalRecords.externalId}
    FROM ${integrationExternalRecords}
    WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
      AND ${integrationExternalRecords.entityType} = 'customer'
      AND ${integrationExternalRecords.localRecordId} = ${customers.id}
    LIMIT 1
  )`,
  nextTaskTitle: sql<string | null>`(
    SELECT ca.title
    FROM ${customerActivities} ca
    WHERE ca.customer_id = ${customers.id}
      AND ca.type = 'task'
      AND ca.status = 'open'
      AND ca.deleted_at IS NULL
    ORDER BY ca.due_date ASC NULLS LAST, ca.created_at ASC, ca.id ASC
    LIMIT 1
  )`.as("nextTaskTitle"),
  nextTaskDueDate: sql<string | null>`(
    SELECT ca.due_date
    FROM ${customerActivities} ca
    WHERE ca.customer_id = ${customers.id}
      AND ca.type = 'task'
      AND ca.status = 'open'
      AND ca.deleted_at IS NULL
    ORDER BY ca.due_date ASC NULLS LAST, ca.created_at ASC, ca.id ASC
    LIMIT 1
  )`.as("nextTaskDueDate"),
  deletedAt: customers.deletedAt,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
} as const;

type CustomerSelectRow = Omit<
  CustomerRow,
  "accountState" | "accountPriority" | "openOrderCount"
> & {
  accountState: string;
  accountPriority: string;
  openOrderCount: number | string;
};

function mapCustomerRow(row: CustomerSelectRow): CustomerRow {
  return {
    ...row,
    accountState: row.accountState as CustomerRow["accountState"],
    accountPriority: row.accountPriority as CustomerRow["accountPriority"],
    openOrderCount: Number(row.openOrderCount),
  };
}

async function getCustomerSalesOrdersInTx(tx: Tx, customerId: string) {
  const rows = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      shipDate: salesOrders.shipDate,
      requestedDate: salesOrders.requestedDate,
      totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
      customerProjectId: salesOrders.customerProjectId,
      customerProjectName: customerProjects.name,
      deletedAt: salesOrders.deletedAt,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .leftJoin(
      customerProjects,
      and(
        eq(salesOrders.customerProjectId, customerProjects.id),
        isNull(customerProjects.deletedAt)
      )
    )
    .where(
      and(eq(salesOrders.customerId, customerId), isNull(salesOrders.deletedAt))
    )
    .orderBy(
      desc(salesOrders.createdAt),
      asc(documentNumberSortSql(salesOrders.orderNumber, "SO")),
      asc(salesOrders.orderNumber)
    );

  return rows.map((row) => ({
    ...row,
    status: row.status as SalesOrderListRow["status"],
  }));
}

async function getCustomerInTx(
  tx: Tx,
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerRow | null> {
  const conditions = [eq(customers.id, id)];
  if (!options?.includeDeleted) {
    conditions.push(isNull(customers.deletedAt));
  }

  const [customer] = await tx
    .select(customerRowSelect)
    .from(customers)
    .leftJoin(
      customerCategories,
      eq(customers.customerCategoryId, customerCategories.id)
    )
    .where(and(...conditions));

  return customer ? mapCustomerRow(customer) : null;
}

export async function getCustomers(): Promise<CustomerRow[]> {
  return measureObservedOperation(
    "sales.get_customers",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const rows = await tx
          .select(customerRowSelect)
          .from(customers)
          .leftJoin(
            customerCategories,
            eq(customers.customerCategoryId, customerCategories.id)
          )
          .where(isNull(customers.deletedAt))
          .orderBy(asc(customers.name));

        return rows.map(mapCustomerRow);
      });
    },
    {
      successData: (rows) => ({
        rowCount: rows.length,
      }),
    }
  );
}

export async function getSalesOrderCustomerOptions(): Promise<CustomerOption[]> {
  return withAuthedOrgContext(async (tx) => {
    const customerRows = await tx
      .select(customerRowSelect)
      .from(customers)
      .leftJoin(
        customerCategories,
        eq(customers.customerCategoryId, customerCategories.id)
      )
      .where(isNull(customers.deletedAt))
      .orderBy(asc(customers.name));

    const projectRows =
      customerRows.length === 0
        ? []
        : await tx
            .select({
              id: customerProjects.id,
              customerId: customerProjects.customerId,
              name: customerProjects.name,
              status: customerProjects.status,
            })
            .from(customerProjects)
            .where(
              and(
                inArray(
                  customerProjects.customerId,
                  customerRows.map((customer) => customer.id)
                ),
                isNull(customerProjects.deletedAt)
              )
            )
            .orderBy(asc(customerProjects.name));

    const projectsByCustomerId = new Map<string, CustomerOption["projects"]>();
    for (const project of projectRows) {
      const projects = projectsByCustomerId.get(project.customerId) ?? [];
      projects.push({
        id: project.id,
        name: project.name,
        status: project.status as CustomerProjectRow["status"],
      });
      projectsByCustomerId.set(project.customerId, projects);
    }

    return customerRows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      projects: projectsByCustomerId.get(customer.id) ?? [],
      billingLine1: customer.billingLine1,
      billingLine2: customer.billingLine2,
      billingCity: customer.billingCity,
      billingRegion: customer.billingRegion,
      billingPostcode: customer.billingPostcode,
      billingCountry: customer.billingCountry,
      shipLine1: customer.shipLine1,
      shipLine2: customer.shipLine2,
      shipCity: customer.shipCity,
      shipRegion: customer.shipRegion,
      shipPostcode: customer.shipPostcode,
      shipCountry: customer.shipCountry,
    }));
  });
}

export async function getCustomer(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerRow | null> {
  return withAuthedOrgContext(async (tx) => {
    return getCustomerInTx(tx, id, options);
  });
}

export async function getCustomerDetail(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerDetailData | null> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await getCustomerInTx(tx, id, options);
    if (!customer) return null;

    const contacts = await getCustomerContactsInTx(tx, id);
    const activities = await getCustomerActivitiesInTx(tx, id);
    const projects = await getCustomerProjectsInTx(tx, id);
    const salesOrderRows = await getCustomerSalesOrdersInTx(tx, id);
    const salesOrdersByProjectId = new Map<
      string,
      typeof salesOrderRows
    >();
    for (const salesOrder of salesOrderRows) {
      if (!salesOrder.customerProjectId) continue;
      const bucket =
        salesOrdersByProjectId.get(salesOrder.customerProjectId) ?? [];
      bucket.push(salesOrder);
      salesOrdersByProjectId.set(salesOrder.customerProjectId, bucket);
    }

    return {
      ...customer,
      contacts,
      activities,
      projects: projects.map((project) => ({
        ...project,
        salesOrders: salesOrdersByProjectId.get(project.id) ?? [],
        orderCount: salesOrdersByProjectId.get(project.id)?.length ?? 0,
        orderValue: normalizeMoney(
          (salesOrdersByProjectId.get(project.id) ?? []).reduce(
            (sum, order) => sum + parseMoneyValue(order.totalAmount),
            0
          )
        ),
      })),
      salesOrders: salesOrderRows,
    };
  });
}

