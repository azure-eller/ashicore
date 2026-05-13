"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  LogoutIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
};

type NavModule = {
  title: string;
  href: string;
  items: NavItem[];
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
  const modules = getNavModules(assignedRoles);

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
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center border-b bg-sidebar text-sidebar-foreground">
      <div className="flex min-w-0 flex-1 items-center">
        <div className="flex min-w-0 shrink-0 items-center gap-2 px-3">
          <NavigationLink
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight text-sidebar-foreground"
          >
            <AshicoreMark />
            <span>ashicore</span>
          </NavigationLink>
        </div>

        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {modules.map((module) => {
            const active = isPathActive(pathname, module.href);

            return (
              <DropdownMenu key={module.title}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "shrink-0 gap-1.5 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
                      active && "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                  >
                    {module.title}
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-48 bg-popover text-popover-foreground"
                >
                  <DropdownMenuGroup>
                    {module.items.map((item) => {
                      const itemActive = isPathActive(pathname, item.href);

                      return (
                        <DropdownMenuItem
                          key={item.href}
                          asChild
                          className={cn(itemActive && "bg-accent text-accent-foreground")}
                        >
                          <NavigationLink href={item.href}>{item.title}</NavigationLink>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center px-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                aria-label="User menu"
              >
                <Avatar className="size-8">
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
  );
}

function getNavModules(assignedRoles: string[]): NavModule[] {
  const modules: Array<NavModule | null> = [
    canReadModule(assignedRoles, "inventory")
      ? {
          title: "Inventory",
          href: "/inventory",
          items: [
            { title: "Products", href: "/inventory/products" },
            { title: "Materials", href: "/inventory/materials" },
            { title: "Sub-assemblies", href: "/inventory/sub-assemblies" },
            { title: "Stocktakes", href: "/inventory/stocktakes" },
            { title: "Ledger", href: "/inventory/ledger" },
          ],
        }
      : null,
    canReadModule(assignedRoles, "sales")
      ? {
          title: "Sales",
          href: "/sales",
          items: [
            { title: "Sales Orders", href: "/sales/orders" },
            { title: "Customers", href: "/sales/customers" },
            { title: "Pricing", href: "/sales/pricing" },
          ],
        }
      : null,
    canReadModule(assignedRoles, "purchasing")
      ? {
          title: "Purchasing",
          href: "/purchasing",
          items: [
            { title: "Purchase Orders", href: "/purchasing/orders" },
            { title: "Suppliers", href: "/purchasing/suppliers" },
          ],
        }
      : null,
    canReadModule(assignedRoles, "manufacturing")
      ? {
          title: "Manufacturing",
          href: "/manufacturing",
          items: [
            { title: "Manufacturing Orders", href: "/manufacturing/orders" },
          ],
        }
      : null,
  ];

  return modules.filter((module): module is NavModule => module !== null);
}

function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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
