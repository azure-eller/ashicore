"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AddCircleIcon,
  CheckmarkCircle02Icon,
  LogoutIcon,
  Search01Icon,
  Settings02Icon,
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
import {
  NavigationLink,
  useNavigationPending,
} from "@/components/navigation-pending";
import { authClient } from "@/lib/auth-client";
import {
  getActiveDashboardModule,
  getDashboardCreateActions,
  getDashboardNavModules,
  getDashboardSearchActions,
  isDashboardPathActive,
} from "@/lib/dashboard-navigation";
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

export function DashboardTopNav({
  user,
  activeOrganizationId,
  organizationName,
  organizations,
  assignedRoles,
}: DashboardTopNavProps) {
  const router = useRouter();
  const { pathname, optimisticPathname, navigate } = useNavigationPending();
  const visiblePathname = optimisticPathname ?? pathname;
  const initials = getInitials(user.name);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pageSearchOpen, setPageSearchOpen] = useState(false);
  const [pageSearch, setPageSearch] = useState("");
  const modules = getDashboardNavModules(assignedRoles);
  const createActions = getDashboardCreateActions(assignedRoles);
  const searchActions = getDashboardSearchActions(assignedRoles);
  const activeModule = getActiveDashboardModule(visiblePathname, modules);
  const normalizedPageSearch = pageSearch.trim().toLowerCase();
  const filteredSearchActions = normalizedPageSearch
    ? searchActions.filter(
        (action) =>
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
              const active = isDashboardPathActive(
                visiblePathname,
                module.baseHref
              );

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
                    id="dashboard-create-menu-trigger"
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
                  id="dashboard-create-menu-content"
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
                  id="dashboard-page-search-trigger"
                  suppressHydrationWarning
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
                id="dashboard-page-search-content"
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
                      const actionPathname = new URL(
                        action.href,
                        "http://dashboard.local"
                      ).pathname;
                      const active = isDashboardPathActive(
                        visiblePathname,
                        actionPathname
                      );
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
                              navigate(action.href);
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
                  id="dashboard-user-menu-trigger"
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
                id="dashboard-user-menu-content"
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
              const active = isDashboardPathActive(visiblePathname, item.href);

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
