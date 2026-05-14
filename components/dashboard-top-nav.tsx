"use client";

import { Fragment, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AddCircleIcon,
  ChartIcon,
  CheckmarkCircle02Icon,
  FactoryIcon,
  Invoice01Icon,
  LogoutIcon,
  Package02Icon,
  PackageAddIcon,
  PackageIcon,
  Search01Icon,
  Settings02Icon,
  ShoppingBag01Icon,
  ShoppingCart01Icon,
  Store01Icon,
  Task01Icon,
  TruckIcon,
  WarehouseIcon,
} from "@hugeicons/core-free-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { NavigationLink } from "@/components/navigation-pending";
import { authClient } from "@/lib/auth-client";
import { canReadModule } from "@/lib/authz";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

type DashboardTopNavProps = {
  user: {
    name: string;
    email: string;
    avatar?: string;
  };
  activeOrganizationId: string;
  organizationName: string;
  organizations: Array<{
    id: string;
    name: string;
    slug: string | null;
  }>;
  assignedRoles: string[];
};

type NavItem = {
  title: string;
  href: string;
  icon: typeof AddCircleIcon;
};

type NavModule = {
  title: string;
  href: string;
  icon: typeof AddCircleIcon;
  items: NavItem[];
};

type CreateAction = {
  title: string;
  href: string;
  module: "inventory" | "sales" | "purchasing" | "manufacturing";
};

type SearchAction = {
  title: string;
  description: string;
  href: string;
  icon: typeof AddCircleIcon;
  group: string;
};

export function DashboardTopNav({
  user,
  activeOrganizationId,
  organizationName,
  organizations,
  assignedRoles,
}: DashboardTopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = getInitials(user.name);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pageSearchOpen, setPageSearchOpen] = useState(false);
  const [pageSearch, setPageSearch] = useState("");
  const modules = getNavModules(assignedRoles);
  const createActions = getCreateActions(assignedRoles);
  const searchActions = getSearchActions(assignedRoles);
  const activeModule = getActiveModule(pathname, modules);
  const normalizedPageSearch = pageSearch.trim().toLowerCase();
  const filteredSearchActions = normalizedPageSearch
    ? searchActions.filter((action) =>
        [action.title, action.group, action.href].some((value) =>
          value.toLowerCase().includes(normalizedPageSearch)
        ) || action.description.toLowerCase().includes(normalizedPageSearch)
      )
    : searchActions;

  async function handleLogout() {
    const { error } = await authClient.signOut();

    if (error) {
      return;
    }

    router.push("/sign-in");
  }

  async function handleSwitchOrganization(organizationId: string) {
    if (organizationId === activeOrganizationId || switchingOrgId) {
      return;
    }

    setSwitchError(null);
    setSwitchingOrgId(organizationId);
    const { error } = await authClient.organization.setActive({
      organizationId,
    });

    if (error) {
      setSwitchError(error.message ?? "Failed to switch organization.");
      setSwitchingOrgId(null);
      return;
    }

    router.refresh();
    setSwitchingOrgId(null);
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center border-b bg-sidebar text-sidebar-foreground">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="flex min-w-0 shrink-0 items-center gap-2 px-5">
            <NavigationLink
              href="/sales/orders"
              className="flex items-center gap-2 text-base font-semibold tracking-tight text-sidebar-foreground"
            >
              <AshicoreMark />
              <span>ashicore</span>
            </NavigationLink>
          </div>

          <nav
            aria-label="Primary"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {modules.map((module) => {
              const active = isPathActive(pathname, module.href);

              return (
                <Button
                  key={module.href}
                  type="button"
                  variant="ghost"
                  size="default"
                  className={cn(
                    "h-16 shrink-0 rounded-none px-5 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground"
                  )}
                  asChild
                >
                  <NavigationLink
                    href={module.href}
                    className="flex flex-col items-center justify-center gap-1.5 text-sm font-medium"
                  >
                    <HugeiconsIcon
                      icon={module.icon}
                      strokeWidth={2}
                      className="size-5"
                    />
                    {module.title}
                  </NavigationLink>
                </Button>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2.5 px-5">
            {createActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 gap-2.5 px-4 text-base font-semibold text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <HugeiconsIcon
                      icon={AddCircleIcon}
                      strokeWidth={2}
                      className="size-5"
                    />
                    Create
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-72 rounded-md bg-popover p-2 text-popover-foreground shadow-lg"
                >
                  <DropdownMenuGroup>
                    {createActions.map((action) => (
                      <DropdownMenuItem
                        key={action.href}
                        asChild
                        className="min-h-11 gap-4 px-3 py-2 text-base font-normal"
                      >
                        <NavigationLink href={action.href}>
                          <HugeiconsIcon
                            icon={Add01Icon}
                            strokeWidth={2}
                            className="size-5 text-muted-foreground"
                          />
                          {action.title}
                        </NavigationLink>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Separator
              orientation="vertical"
              className="mx-1 h-8 bg-sidebar-border/70"
            />
            <Popover open={pageSearchOpen} onOpenChange={setPageSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  aria-label="Search pages"
                >
                  <HugeiconsIcon
                    icon={Search01Icon}
                    strokeWidth={2}
                    className="size-5"
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-96 gap-2 rounded-md bg-popover p-2 text-popover-foreground shadow-lg"
              >
                <Input
                  value={pageSearch}
                  onChange={(event) => setPageSearch(event.target.value)}
                  placeholder="Search pages..."
                  aria-label="Search pages"
                  className="h-10 text-base"
                />
                <div className="max-h-96 overflow-y-auto">
                  {filteredSearchActions.length > 0 ? (
                    filteredSearchActions.map((action, index) => {
                      const active = isPathActive(pathname, action.href);
                      const showGroup =
                        index === 0 ||
                        filteredSearchActions[index - 1]?.group !== action.group;

                      return (
                        <Fragment key={action.href}>
                          {showGroup ? (
                            <div className="mt-2 bg-muted px-2.5 py-1.5 text-xs font-semibold uppercase tracking-normal text-muted-foreground first:mt-0">
                              {action.group}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className={cn(
                              "flex min-h-14 w-full items-center gap-3 rounded-none px-2.5 py-2 text-left text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                              active && "bg-accent text-accent-foreground"
                            )}
                            onClick={() => {
                              setPageSearchOpen(false);
                              setPageSearch("");
                              router.push(action.href);
                            }}
                          >
                            <HugeiconsIcon
                              icon={action.icon}
                              strokeWidth={2}
                              className="size-5 shrink-0 text-muted-foreground"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{action.title}</span>
                              <span className="block truncate text-sm text-muted-foreground">
                                {action.description}
                              </span>
                            </span>
                          </button>
                        </Fragment>
                      );
                    })
                  ) : (
                    <div className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                      No pages found.
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 rounded-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  aria-label="User menu"
                >
                  <Avatar className="size-10">
                    {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-72 bg-popover text-popover-foreground"
              >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8">
                    {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {organizationName}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Organization</DropdownMenuLabel>
              <DropdownMenuGroup>
                {organizations.map((organization) => {
                  const active = organization.id === activeOrganizationId;

                  return (
                    <DropdownMenuItem
                      key={organization.id}
                      disabled={active || switchingOrgId != null}
                      onSelect={(event) => {
                        event.preventDefault();
                        void handleSwitchOrganization(organization.id);
                      }}
                      className="gap-2"
                    >
                      <div className="grid min-w-0 flex-1">
                        <span className="truncate">{organization.name}</span>
                        {organization.slug ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {organization.slug}
                          </span>
                        ) : null}
                      </div>
                      {active ? (
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          strokeWidth={2}
                          className="size-4"
                        />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              {switchError ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-destructive">
                    {switchError}
                  </DropdownMenuLabel>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <NavigationLink href="/settings">
                    <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
                    Settings
                  </NavigationLink>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <HugeiconsIcon icon={LogoutIcon} strokeWidth={2} />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      {activeModule ? (
        <nav
          aria-label={`${activeModule.title} pages`}
          className="flex h-10 shrink-0 items-end border-b bg-background px-6"
        >
          <div className="flex min-w-0 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {activeModule.items.map((item) => {
              const active = isPathActive(pathname, item.href);

              return (
                <NavigationLink
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex h-10 shrink-0 items-center border-b-2 border-transparent px-4 text-base font-medium text-muted-foreground hover:text-foreground",
                    active && "border-primary text-primary"
                  )}
                >
                  {item.title}
                </NavigationLink>
              );
            })}
          </div>
        </nav>
      ) : null}
    </>
  );
}

function getNavModules(assignedRoles: string[]): NavModule[] {
  const modules: Array<NavModule | null> = [
    canReadModule(assignedRoles, "sales")
      ? {
          title: "Sales",
          href: "/sales",
          icon: ShoppingCart01Icon,
          items: [
            { title: "Sales Orders", href: "/sales/orders", icon: Invoice01Icon },
            { title: "Customers", href: "/sales/customers", icon: Store01Icon },
            { title: "Pricing", href: "/sales/pricing", icon: ChartIcon },
          ],
        }
      : null,
    canReadModule(assignedRoles, "inventory")
      ? {
          title: "Inventory",
          href: "/inventory",
          icon: WarehouseIcon,
          items: [
            { title: "Products", href: "/inventory/products", icon: PackageIcon },
            { title: "Materials", href: "/inventory/materials", icon: Package02Icon },
            {
              title: "Sub-assemblies",
              href: "/inventory/sub-assemblies",
              icon: PackageAddIcon,
            },
            { title: "Stocktakes", href: "/inventory/stocktakes", icon: Task01Icon },
            { title: "Ledger", href: "/inventory/ledger", icon: ChartIcon },
          ],
        }
      : null,
    canReadModule(assignedRoles, "purchasing")
      ? {
          title: "Purchasing",
          href: "/purchasing",
          icon: ShoppingBag01Icon,
          items: [
            {
              title: "Purchase Orders",
              href: "/purchasing/orders",
              icon: ShoppingBag01Icon,
            },
            { title: "Suppliers", href: "/purchasing/suppliers", icon: TruckIcon },
          ],
        }
      : null,
    canReadModule(assignedRoles, "manufacturing")
      ? {
          title: "Manufacturing",
          href: "/manufacturing",
          icon: FactoryIcon,
          items: [
            {
              title: "Manufacturing Orders",
              href: "/manufacturing/orders",
              icon: FactoryIcon,
            },
          ],
        }
      : null,
  ];

  return modules.filter((module): module is NavModule => module !== null);
}

function getCreateActions(assignedRoles: string[]): CreateAction[] {
  const actions: CreateAction[] = [
    {
      title: "Sales Order",
      href: "/sales/orders/new",
      module: "sales",
    },
    {
      title: "Customer",
      href: "/sales/customers/new",
      module: "sales",
    },
    {
      title: "Material",
      href: "/inventory/materials/new",
      module: "inventory",
    },
    {
      title: "Product",
      href: "/inventory/products/new",
      module: "inventory",
    },
    {
      title: "Stocktake",
      href: "/inventory/stocktakes/new",
      module: "inventory",
    },
    {
      title: "Purchase Order",
      href: "/purchasing/orders/new",
      module: "purchasing",
    },
    {
      title: "Supplier",
      href: "/purchasing/suppliers/new",
      module: "purchasing",
    },
    {
      title: "Manufacturing Order",
      href: "/manufacturing/orders/new",
      module: "manufacturing",
    },
  ];

  return actions.filter((action) => canReadModule(assignedRoles, action.module));
}

function getSearchActions(assignedRoles: string[]): SearchAction[] {
  const actions: SearchAction[] = [];

  if (canReadModule(assignedRoles, "sales")) {
    actions.push(
      {
        title: "New Sales Order",
        description: "Create a new sales order",
        href: "/sales/orders/new",
        icon: Add01Icon,
        group: "Sales",
      },
      {
        title: "New Customer",
        description: "Create a new customer",
        href: "/sales/customers/new",
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
        href: "/inventory/materials/new",
        icon: Add01Icon,
        group: "Inventory",
      },
      {
        title: "New Product",
        description: "Create a new product",
        href: "/inventory/products/new",
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
        title: "Inventory - Sub-assemblies",
        description: "View all sub-assemblies",
        href: "/inventory/sub-assemblies",
        icon: PackageAddIcon,
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
        href: "/purchasing/orders/new",
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
        title: "Purchase Orders - Cancelled",
        description: "View cancelled purchase orders",
        href: "/purchasing/orders?status=cancelled",
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
        href: "/manufacturing/orders/new",
        icon: Add01Icon,
        group: "Manufacturing",
      },
      {
        title: "Manufacturing Orders - Draft",
        description: "View draft manufacturing orders",
        href: "/manufacturing/orders?status=draft",
        icon: FactoryIcon,
        group: "Manufacturing",
      },
      {
        title: "Manufacturing Orders - Released",
        description: "View released manufacturing orders",
        href: "/manufacturing/orders?status=released",
        icon: FactoryIcon,
        group: "Manufacturing",
      },
      {
        title: "Manufacturing Orders - Completed",
        description: "View completed manufacturing orders",
        href: "/manufacturing/orders?status=completed",
        icon: FactoryIcon,
        group: "Manufacturing",
      },
      {
        title: "Manufacturing Orders - Cancelled",
        description: "View cancelled manufacturing orders",
        href: "/manufacturing/orders?status=cancelled",
        icon: FactoryIcon,
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

function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getActiveModule(pathname: string, modules: NavModule[]) {
  return modules.find((module) => isPathActive(pathname, module.href)) ?? null;
}

function AshicoreMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 108 108"
      className="size-5 shrink-0"
      fill="currentColor"
    >
      <path d="M16 14h59v20H16z" />
      <path d="M80 14h19v67H80z" />
      <path d="M16 39h20v58H16z" />
      <path d="M47 45h23v23H47z" />
      <path d="M40 78h59v19H40z" />
    </svg>
  );
}
