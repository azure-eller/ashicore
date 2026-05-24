import {
  Add01Icon,
  AddCircleIcon,
  ChartIcon,
  FactoryIcon,
  GridTableIcon,
  Invoice01Icon,
  Package02Icon,
  PackageIcon,
  Settings02Icon,
  ShoppingBag01Icon,
  ShoppingCart01Icon,
  Store01Icon,
  Task01Icon,
  TruckIcon,
  WarehouseIcon,
} from "@hugeicons/core-free-icons";
import { canReadModule } from "@/lib/authz";

export type DashboardModuleKey =
  | "inventory"
  | "sales"
  | "purchasing"
  | "manufacturing";

export type DashboardIcon = typeof AddCircleIcon;

export type DashboardNavItem = {
  title: string;
  href: string;
  icon: DashboardIcon;
};

export type DashboardNavModule = {
  title: string;
  baseHref: string;
  href: string;
  icon: DashboardIcon;
  module: DashboardModuleKey;
  items: DashboardNavItem[];
};

export type DashboardCreateAction = {
  title: string;
  href: string;
  module: DashboardModuleKey;
};

export type DashboardSearchAction = {
  title: string;
  description: string;
  href: string;
  icon: DashboardIcon;
  group: string;
};

export type DashboardRouteShell = {
  title: string;
  href: string;
  kind: "list" | "create" | "detail" | "settings" | "generic";
};

type DashboardNavigationOptions = {
  salesAllocationMode?: "manual" | "demand_queue";
};

function filterNavItemsForOptions(
  items: DashboardNavItem[],
  _options?: DashboardNavigationOptions
) {
  void _options;
  return items;
}

const dashboardNavModules: DashboardNavModule[] = [
  {
    title: "Sales",
    baseHref: "/sales",
    href: "/sales/orders",
    icon: ShoppingCart01Icon,
    module: "sales",
    items: [
      { title: "Sales Orders", href: "/sales/orders", icon: Invoice01Icon },
      { title: "Allocation", href: "/sales/allocation", icon: GridTableIcon },
      { title: "Customers", href: "/sales/customers", icon: Store01Icon },
      { title: "Pricing", href: "/sales/pricing", icon: ChartIcon },
    ],
  },
  {
    title: "Manufacturing",
    baseHref: "/manufacturing",
    href: "/manufacturing/orders",
    icon: FactoryIcon,
    module: "manufacturing",
    items: [
      {
        title: "Manufacturing Orders",
        href: "/manufacturing/orders",
        icon: FactoryIcon,
      },
      {
        title: "Resources",
        href: "/manufacturing/resources",
        icon: Task01Icon,
      },
    ],
  },
  {
    title: "Inventory",
    baseHref: "/inventory",
    href: "/inventory/products",
    icon: WarehouseIcon,
    module: "inventory",
    items: [
      { title: "Products", href: "/inventory/products", icon: PackageIcon },
      { title: "Materials", href: "/inventory/materials", icon: Package02Icon },
      { title: "Stocktakes", href: "/inventory/stocktakes", icon: Task01Icon },
      { title: "Ledger", href: "/inventory/ledger", icon: ChartIcon },
    ],
  },
  {
    title: "Purchasing",
    baseHref: "/purchasing",
    href: "/purchasing/orders",
    icon: ShoppingBag01Icon,
    module: "purchasing",
    items: [
      {
        title: "Purchase Orders",
        href: "/purchasing/orders",
        icon: ShoppingBag01Icon,
      },
      { title: "Suppliers", href: "/purchasing/suppliers", icon: TruckIcon },
    ],
  },
];

const dashboardCreateActions: DashboardCreateAction[] = [
  { title: "Sales Order", href: "/sales/order", module: "sales" },
  { title: "Customer", href: "/sales/customer", module: "sales" },
  { title: "Material", href: "/inventory/material", module: "inventory" },
  { title: "Product", href: "/inventory/product", module: "inventory" },
  { title: "Stocktake", href: "/inventory/stocktakes/new", module: "inventory" },
  {
    title: "Purchase Order",
    href: "/purchasing/order",
    module: "purchasing",
  },
  { title: "Supplier", href: "/purchasing/suppliers/new", module: "purchasing" },
  {
    title: "Manufacturing Order",
    href: "/manufacturing/order",
    module: "manufacturing",
  },
];

export function getDashboardNavModules(
  assignedRoles: string[],
  options?: DashboardNavigationOptions
) {
  return dashboardNavModules
    .filter((module) => canReadModule(assignedRoles, module.module))
    .map((module) => ({
      ...module,
      items: filterNavItemsForOptions(module.items, options),
    }));
}

export function getDashboardCreateActions(assignedRoles: string[]) {
  return dashboardCreateActions.filter((action) =>
    canReadModule(assignedRoles, action.module)
  );
}

export function getDashboardSearchActions(
  assignedRoles: string[],
  _options?: DashboardNavigationOptions
): DashboardSearchAction[] {
  void _options;
  const actions: DashboardSearchAction[] = [];

  if (canReadModule(assignedRoles, "sales")) {
    actions.push(
      {
        title: "New Sales Order",
        description: "Create a new sales order",
        href: "/sales/order",
        icon: Add01Icon,
        group: "Sales",
      },
      {
        title: "New Customer",
        description: "Create a new customer",
        href: "/sales/customer",
        icon: Add01Icon,
        group: "Sales",
      },
      {
        title: "Sales Orders - All",
        description: "View all sales orders",
        href: "/sales/orders",
        icon: Invoice01Icon,
        group: "Sales",
      },
      {
        title: "Allocation",
        description: "View open sales order manual reservations",
        href: "/sales/allocation",
        icon: GridTableIcon,
        group: "Sales",
      },
      {
        title: "Customers",
        description: "View customers",
        href: "/sales/customers",
        icon: Store01Icon,
        group: "Sales",
      },
      {
        title: "Pricing",
        description: "View pricing schedules",
        href: "/sales/pricing",
        icon: ChartIcon,
        group: "Sales",
      }
    );
  }

  if (canReadModule(assignedRoles, "inventory")) {
    actions.push(
      {
        title: "New Material",
        description: "Create a new material",
        href: "/inventory/material",
        icon: Add01Icon,
        group: "Inventory",
      },
      {
        title: "New Product",
        description: "Create a new product",
        href: "/inventory/product",
        icon: Add01Icon,
        group: "Inventory",
      },
      {
        title: "New Stocktake",
        description: "Create a new stocktake",
        href: "/inventory/stocktakes/new",
        icon: Add01Icon,
        group: "Inventory",
      },
      {
        title: "Inventory - Materials",
        description: "View all materials",
        href: "/inventory/materials",
        icon: Package02Icon,
        group: "Inventory",
      },
      {
        title: "Inventory - Products",
        description: "View all products",
        href: "/inventory/products",
        icon: PackageIcon,
        group: "Inventory",
      },
      {
        title: "Inventory - Stocktakes",
        description: "View stocktakes",
        href: "/inventory/stocktakes",
        icon: Task01Icon,
        group: "Inventory",
      },
      {
        title: "Inventory - Ledger",
        description: "View inventory movements",
        href: "/inventory/ledger",
        icon: ChartIcon,
        group: "Inventory",
      }
    );
  }

  if (canReadModule(assignedRoles, "purchasing")) {
    actions.push(
      {
        title: "New Purchase Order",
        description: "Create a new purchase order",
        href: "/purchasing/order",
        icon: Add01Icon,
        group: "Purchasing",
      },
      {
        title: "New Supplier",
        description: "Create a new supplier",
        href: "/purchasing/suppliers/new",
        icon: Add01Icon,
        group: "Purchasing",
      },
      {
        title: "Purchase Orders - All",
        description: "View all purchase orders",
        href: "/purchasing/orders?status=all",
        icon: ShoppingBag01Icon,
        group: "Purchasing",
      },
      {
        title: "Purchase Orders - Draft",
        description: "View draft purchase orders",
        href: "/purchasing/orders?status=draft",
        icon: ShoppingBag01Icon,
        group: "Purchasing",
      },
      {
        title: "Purchase Orders - Ordered",
        description: "View ordered purchase orders",
        href: "/purchasing/orders?status=ordered",
        icon: ShoppingBag01Icon,
        group: "Purchasing",
      },
      {
        title: "Purchase Orders - Partially Received",
        description: "View partially received purchase orders",
        href: "/purchasing/orders?status=partial",
        icon: ShoppingBag01Icon,
        group: "Purchasing",
      },
      {
        title: "Purchase Orders - Received",
        description: "View received purchase orders",
        href: "/purchasing/orders?status=received",
        icon: ShoppingBag01Icon,
        group: "Purchasing",
      },
      {
        title: "Suppliers",
        description: "View suppliers",
        href: "/purchasing/suppliers",
        icon: TruckIcon,
        group: "Purchasing",
      }
    );
  }

  if (canReadModule(assignedRoles, "manufacturing")) {
    actions.push(
      {
        title: "New Manufacturing Order",
        description: "Create a new manufacturing order",
        href: "/manufacturing/order",
        icon: Add01Icon,
        group: "Manufacturing",
      },
      {
        title: "Manufacturing Orders - Open",
        description: "View open manufacturing orders",
        href: "/manufacturing/orders?status=open",
        icon: FactoryIcon,
        group: "Manufacturing",
      },
      {
        title: "Manufacturing Orders - Done",
        description: "View done manufacturing orders",
        href: "/manufacturing/orders?status=done",
        icon: FactoryIcon,
        group: "Manufacturing",
      },
      {
        title: "Manufacturing Resources",
        description: "View manufacturing resource rates",
        href: "/manufacturing/resources",
        icon: Task01Icon,
        group: "Manufacturing",
      }
    );
  }

  actions.push({
    title: "Settings",
    description: "View account and team settings",
    href: "/settings",
    icon: Settings02Icon,
    group: "Account",
  });

  return actions;
}

export function isDashboardPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getActiveDashboardModule(
  pathname: string,
  modules: DashboardNavModule[]
) {
  return (
    modules.find((module) => isDashboardPathActive(pathname, module.baseHref)) ??
    null
  );
}

export function resolveDashboardNavigationHref(href: string) {
  const url = new URL(href, "http://dashboard.local");
  const navModule = dashboardNavModules.find(
    (navModule) => navModule.baseHref === url.pathname
  );

  if (navModule) {
    return `${navModule.href}${url.search}`;
  }

  return `${url.pathname}${url.search}`;
}

export function getDashboardRouteShell(href: string): DashboardRouteShell {
  const resolvedHref = resolveDashboardNavigationHref(href);
  const url = new URL(resolvedHref, "http://dashboard.local");
  const pathname = url.pathname;
  const exactItem = dashboardNavModules
    .flatMap((module) => module.items)
    .find((item) => item.href === pathname);

  if (exactItem) {
    return { title: exactItem.title, href: resolvedHref, kind: "list" };
  }

  const createAction = dashboardCreateActions.find((action) => action.href === pathname);

  if (createAction) {
    return { title: `New ${createAction.title}`, href: resolvedHref, kind: "create" };
  }

  if (pathname.startsWith("/sales/order/") || pathname.startsWith("/sales/orders/")) {
    return { title: "Sales Order", href: resolvedHref, kind: "detail" };
  }

  if (pathname.startsWith("/sales/customers/")) {
    return { title: "Customer", href: resolvedHref, kind: "detail" };
  }

  if (pathname.startsWith("/inventory/products/")) {
    return { title: "Product", href: resolvedHref, kind: "detail" };
  }

  if (pathname.startsWith("/inventory/materials/")) {
    return { title: "Material", href: resolvedHref, kind: "detail" };
  }

  if (
    pathname.startsWith("/purchasing/order/") ||
    pathname.startsWith("/purchasing/orders/")
  ) {
    return { title: "Purchase Order", href: resolvedHref, kind: "detail" };
  }

  if (pathname.startsWith("/purchasing/suppliers/")) {
    return { title: "Supplier", href: resolvedHref, kind: "detail" };
  }

  if (
    pathname.startsWith("/manufacturing/order/") ||
    pathname.startsWith("/manufacturing/orders/")
  ) {
    return { title: "Manufacturing Order", href: resolvedHref, kind: "detail" };
  }

  if (pathname.startsWith("/settings")) {
    return { title: "Settings", href: resolvedHref, kind: "settings" };
  }

  return { title: "Loading", href: resolvedHref, kind: "generic" };
}

export function sanitizeDashboardNavigationPath(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) {
        return segment;
      }

      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          segment
        ) ||
        /^[0-9a-f]{20,}$/i.test(segment)
      ) {
        return "[id]";
      }

      return segment;
    })
    .join("/");
}
