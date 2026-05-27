"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AddCircleIcon,
  CheckmarkCircle02Icon,
  LogoutIcon,
  Search01Icon,
  Settings02Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AshicoreLogo } from "@/components/brand/ashicore-logo";
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

type SalesAllocationMode = "manual" | "demand_queue";

type DashboardTopNavProps = {
  user: {
    name: string;
    email: string;
    avatar?: string;
  };
  activeOrganizationId: string;
  organizationName: string;
  allocationMode: SalesAllocationMode;
  organizations: Array<{
    id: string;
    name: string;
    slug: string | null;
  }>;
  assignedRoles: string[];
};

const DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:4321/docs" : "/docs");

export function DashboardTopNav({
  user,
  activeOrganizationId,
  organizationName,
  allocationMode,
  organizations,
  assignedRoles,
}: DashboardTopNavProps) {
  const router = useRouter();
  const { pathname, optimisticPathname, navigate } = useNavigationPending();
  const [hydratedPathname, setHydratedPathname] = useState<string | null>(null);
  const visiblePathname = optimisticPathname ?? hydratedPathname ?? "";
  const initials = getInitials(user.name);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pageSearchOpen, setPageSearchOpen] = useState(false);
  const [pageSearch, setPageSearch] = useState("");
  const modules = getDashboardNavModules(assignedRoles, {
    salesAllocationMode: allocationMode,
  });
  const createActions = getDashboardCreateActions(assignedRoles);
  const searchActions = getDashboardSearchActions(assignedRoles, {
    salesAllocationMode: allocationMode,
  });
  const activeModule = getActiveDashboardModule(visiblePathname, modules);
  const visibleModule = activeModule ?? modules[0] ?? null;
  const normalizedPageSearch = pageSearch.trim().toLowerCase();
  const filteredSearchActions = normalizedPageSearch
    ? searchActions.filter(
        (action) =>
          [action.title, action.group, action.href].some((value) =>
            value.toLowerCase().includes(normalizedPageSearch)
          ) || action.description.toLowerCase().includes(normalizedPageSearch)
      )
    : searchActions;

  useEffect(() => {
    setHydratedPathname(pathname);
  }, [pathname]);

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
      <header className="flex h-(--height-nav) w-full min-w-0 shrink-0 items-center overflow-hidden border-b bg-sidebar text-sidebar-foreground">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="mr-(--space-5) flex h-(--height-nav) min-w-0 shrink-0 items-center gap-(--space-5) border-r border-sidebar-border px-(--space-10) pr-(--space-12) max-sm:px-(--space-6) max-sm:pr-(--space-8)">
            <NavigationLink
              href="/sales/orders"
              className="flex items-center gap-(--space-5) text-[length:var(--text-lg)] font-semibold tracking-[0] text-sidebar-foreground"
            >
              <AshicoreLogo showWordmark markClassName="size-(--space-10)" />
            </NavigationLink>
          </div>

          <nav
            aria-label="Primary"
            className="flex min-w-0 flex-1 items-center gap-(--space-2) overflow-x-auto px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {modules.map((module) => {
              const active = isDashboardPathActive(
                visiblePathname,
                module.baseHref
              );
              const showingSubNav = visibleModule?.baseHref === module.baseHref;

              return (
                <Button
                  key={module.href}
                  type="button"
                  variant="ghost"
                  size="default"
                  className={cn(
                    "relative h-(--height-input-md) shrink-0 rounded-none px-(--space-7) text-sidebar-foreground/80 transition-colors duration-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    showingSubNav && "bg-sidebar-accent text-sidebar-accent-foreground",
                    active &&
                      "font-semibold text-sidebar-accent-foreground shadow-[inset_0_-2px_0_var(--color-accent)]"
                  )}
                  asChild
                >
                  <NavigationLink
                    href={module.href}
                    aria-current={active ? "true" : undefined}
                    className="flex items-center justify-center gap-(--space-4) text-[length:var(--text-md)] leading-[var(--leading-sm)] font-medium"
                  >
                    <HugeiconsIcon
                      icon={module.icon}
                      strokeWidth={2}
                      className="size-(--space-10)"
                    />
                    {module.title}
                  </NavigationLink>
                </Button>
              );
            })}
          </nav>

          <div className="flex min-w-0 shrink-0 items-center gap-[11px] px-[22px] max-sm:gap-[8px] max-sm:px-[12px]">
            {createActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    id="dashboard-create-menu-trigger"
                    type="button"
                    variant="default"
                    className="h-[41px] gap-[8px] px-[16px] text-[17px] font-medium text-primary-foreground max-sm:px-[11px]"
                  >
                    <HugeiconsIcon
                      icon={AddCircleIcon}
                      strokeWidth={2}
                      className="size-[18px]"
                    />
                    <span className="max-sm:sr-only">Create</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  id="dashboard-create-menu-content"
                  align="end"
                  className="min-w-72 rounded-(--radius-none) bg-popover p-(--space-4) text-popover-foreground shadow-[var(--shadow-overlay)]"
                >
                  <DropdownMenuGroup>
                    {createActions.map((action) => (
                      <DropdownMenuItem
                        key={action.href}
                        asChild
                        className="min-h-(--height-input-md) gap-(--space-8) px-(--space-6) py-(--space-4) text-[length:var(--text-base)] font-normal"
                      >
                        <NavigationLink href={action.href}>
                          <HugeiconsIcon
                            icon={Add01Icon}
                            strokeWidth={2}
                            className="size-(--space-10) text-muted-foreground"
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
              className="mx-[0] h-[41px] bg-sidebar-border/70 max-sm:hidden"
            />
            <Popover open={pageSearchOpen} onOpenChange={setPageSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="dashboard-page-search-trigger"
                  suppressHydrationWarning
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-[41px] text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
                  aria-label="Search pages"
                >
                  <HugeiconsIcon
                    icon={Search01Icon}
                    strokeWidth={2}
                    className="size-[19px]"
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                id="dashboard-page-search-content"
                align="end"
                className="w-96 gap-(--space-4) rounded-(--radius-none) bg-popover p-(--space-4) text-popover-foreground shadow-[var(--shadow-overlay)]"
              >
                <Input
                  value={pageSearch}
                  onChange={(event) => setPageSearch(event.target.value)}
                  placeholder="Search pages..."
                  aria-label="Search pages"
                  className="text-[length:var(--text-base)]"
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
                            <div className="mt-(--space-4) bg-muted px-(--space-5) py-(--space-3) text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase first:mt-0">
                              {action.group}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className={cn(
                              "flex min-h-(--height-input-lg) w-full items-center gap-(--space-6) rounded-none px-(--space-5) py-(--space-4) text-left text-[length:var(--text-base)] outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
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
                              className="size-(--space-10) shrink-0 text-muted-foreground"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{action.title}</span>
                              <span className="block truncate text-[length:var(--text-sm)] text-muted-foreground">
                                {action.description}
                              </span>
                            </span>
                          </button>
                        </Fragment>
                      );
                    })
                  ) : (
                    <div className="px-(--space-5) py-(--space-12) text-center text-[length:var(--text-sm)] text-muted-foreground">
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
                  className="size-[41px] rounded-full text-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
                  aria-label="User menu"
                >
                  <Avatar className="size-[41px]">
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
                  <div className="flex items-center gap-(--space-4) px-(--space-2) py-(--space-3) text-left text-[length:var(--text-sm)]">
                    <Avatar className="size-8">
                      {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-[length:var(--text-sm)] leading-[var(--leading-sm)]">
                      <span className="truncate font-medium">{user.name}</span>
                      <span className="truncate text-[length:var(--text-xs)] text-muted-foreground">
                        {user.email}
                      </span>
                      <span className="truncate text-[length:var(--text-xs)] text-muted-foreground">
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
                        className="gap-(--space-4)"
                      >
                        <div className="grid min-w-0 flex-1">
                          <span className="truncate">{organization.name}</span>
                          {organization.slug ? (
                            <span className="truncate text-[length:var(--text-xs)] text-muted-foreground">
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
                    <DropdownMenuLabel className="text-[length:var(--text-xs)] font-normal text-destructive">
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
                  <DropdownMenuItem asChild>
                    <a href={DOCS_URL}>
                      <HugeiconsIcon icon={Task01Icon} strokeWidth={2} />
                      Documentation
                    </a>
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
      <nav
        aria-label={
          visibleModule
            ? `${visibleModule.title} pages`
            : "Section pages"
        }
        className="flex h-(--height-subnav) w-full min-w-0 shrink-0 items-stretch overflow-hidden border-b bg-background px-(--space-10) max-sm:px-(--space-6)"
      >
        {visibleModule ? (
          <div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleModule.items.map((item) => {
              const active = isDashboardPathActive(visiblePathname, item.href);

              return (
                <NavigationLink
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-(--height-subnav) shrink-0 items-center px-(--space-5) text-[length:var(--text-base)] leading-[var(--leading-sm)] font-medium text-muted-foreground shadow-[inset_0_-2px_0_transparent] hover:text-foreground",
                    active &&
                      "font-semibold text-primary shadow-[inset_0_-2px_0_var(--color-accent)]"
                  )}
                >
                  {item.title}
                </NavigationLink>
              );
            })}
          </div>
        ) : null}
      </nav>
    </>
  );
}
