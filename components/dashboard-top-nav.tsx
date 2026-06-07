"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AddCircleIcon,
  CheckmarkCircle02Icon,
  LogoutIcon,
  MoreHorizontalIcon,
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

const DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:4321/docs" : "/docs");

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type NavModule = ReturnType<typeof getDashboardNavModules>[number];

function ModuleTab({
  module,
  active,
  showingSubNav,
}: {
  module: NavModule;
  active: boolean;
  showingSubNav: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      className={cn(
        "relative h-(--height-input-sm) shrink-0 rounded-(--radius-md) px-(--space-6) text-[var(--chrome-fg-soft)] transition-colors duration-100 hover:bg-[var(--chrome-line)] hover:text-[var(--chrome-fg)]",
        (showingSubNav || active) &&
          "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
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
          className="size-(--space-9)"
        />
        {module.title}
      </NavigationLink>
    </Button>
  );
}

function ModuleNav({
  modules,
  visiblePathname,
  visibleModule,
}: {
  modules: NavModule[];
  visiblePathname: string;
  visibleModule: NavModule | null | undefined;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(modules.length);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const tabs = Array.from(
        measure.querySelectorAll<HTMLElement>("[data-module-tab]")
      );
      if (tabs.length === 0) return;

      const available = container.clientWidth;
      const right = (element: HTMLElement) =>
        element.offsetLeft + element.offsetWidth;
      const gap =
        tabs.length > 1 ? Math.max(0, tabs[1].offsetLeft - right(tabs[0])) : 0;
      const moreTab = measure.querySelector<HTMLElement>("[data-more-tab]");
      const reservedForMore = moreTab ? moreTab.offsetWidth + gap : 0;

      let count = tabs.length;
      if (right(tabs[tabs.length - 1]) > available) {
        count = 0;
        for (let index = 0; index < tabs.length; index += 1) {
          if (right(tabs[index]) + reservedForMore <= available) {
            count = index + 1;
          } else {
            break;
          }
        }
      }

      setVisibleCount(count);
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [modules]);

  const visibleModules = modules.slice(0, visibleCount);
  const overflowModules = modules.slice(visibleCount);
  const overflowActive = overflowModules.some((module) =>
    isDashboardPathActive(visiblePathname, module.baseHref)
  );

  return (
    <nav
      ref={containerRef}
      aria-label="Primary"
      className="relative flex min-w-0 flex-1 items-center gap-(--space-2) overflow-hidden px-0"
    >
      {visibleModules.map((module) => (
        <ModuleTab
          key={module.href}
          module={module}
          active={isDashboardPathActive(visiblePathname, module.baseHref)}
          showingSubNav={visibleModule?.baseHref === module.baseHref}
        />
      ))}

      {overflowModules.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="default"
              aria-label="More modules"
              className={cn(
                "relative h-(--height-input-sm) shrink-0 gap-(--space-4) rounded-(--radius-md) px-(--space-6) text-[length:var(--text-md)] leading-[var(--leading-sm)] font-medium text-[var(--chrome-fg-soft)] transition-colors duration-100 hover:bg-[var(--chrome-line)] hover:text-[var(--chrome-fg)] data-[state=open]:bg-[var(--chrome-line)] data-[state=open]:text-[var(--chrome-fg)]",
                overflowActive &&
                  "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
              )}
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                strokeWidth={2}
                className="size-(--space-9)"
              />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-56 rounded-(--radius-md) bg-[var(--color-surface)] p-(--space-4) text-[var(--color-ink)] shadow-[var(--shadow-overlay)]"
          >
            <DropdownMenuGroup>
              {overflowModules.map((module) => {
                const active = isDashboardPathActive(
                  visiblePathname,
                  module.baseHref
                );

                return (
                  <DropdownMenuItem
                    key={module.href}
                    asChild
                    className={cn(
                      "min-h-(--height-input-sm) gap-(--space-5) px-(--space-5) py-(--space-4) text-[length:var(--text-base)] font-medium",
                      active &&
                        "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                    )}
                  >
                    <NavigationLink
                      href={module.href}
                      aria-current={active ? "true" : undefined}
                    >
                      <HugeiconsIcon
                        icon={module.icon}
                        strokeWidth={2}
                        className="size-(--space-8) text-[var(--color-ink-faint)]"
                      />
                      {module.title}
                    </NavigationLink>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-(--space-2)"
      >
        {modules.map((module) => (
          <div key={module.href} data-module-tab>
            <ModuleTab module={module} active={false} showingSubNav={false} />
          </div>
        ))}
        <div data-more-tab>
          <Button
            type="button"
            variant="ghost"
            size="default"
            className="relative h-(--height-input-sm) shrink-0 gap-(--space-4) rounded-(--radius-md) px-(--space-6) text-[length:var(--text-md)] leading-[var(--leading-sm)] font-medium"
          >
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              strokeWidth={2}
              className="size-(--space-9)"
            />
            More
          </Button>
        </div>
      </div>
    </nav>
  );
}

export function DashboardTopNav({
  user,
  activeOrganizationId,
  organizationName,
  organizations,
  assignedRoles,
}: DashboardTopNavProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pathname, optimisticPathname, navigate } = useNavigationPending();
  const [hydratedPathname, setHydratedPathname] = useState<string | null>(null);
  const visiblePathname = optimisticPathname ?? hydratedPathname ?? "";
  const initials = getInitials(user.name);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pageSearchOpen, setPageSearchOpen] = useState(false);
  const [pageSearch, setPageSearch] = useState("");
  const modules = getDashboardNavModules(assignedRoles);
  const createActions = getDashboardCreateActions(assignedRoles);
  const searchActions = getDashboardSearchActions(assignedRoles);
  const activeModule = getActiveDashboardModule(visiblePathname, modules);
  const visibleModule = activeModule;
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

  useEffect(() => {
    function handlePageSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return;
        }

        event.preventDefault();
        setPageSearchOpen(true);
      }
    }

    window.addEventListener("keydown", handlePageSearchShortcut);
    return () => window.removeEventListener("keydown", handlePageSearchShortcut);
  }, []);

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

    queryClient.clear();
    router.refresh();
    setSwitchingOrgId(null);
  }

  return (
    <>
      <header className="flex h-(--height-nav) w-full min-w-0 shrink-0 items-center overflow-hidden border-b border-[var(--chrome-line)] bg-[var(--chrome-bg)] text-[var(--chrome-fg)]">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="mr-(--space-5) flex h-(--height-nav) min-w-0 shrink-0 items-center gap-(--space-5) border-r border-[var(--chrome-line)] px-(--space-10) pr-(--space-12) max-sm:px-(--space-6) max-sm:pr-(--space-8)">
            <NavigationLink
              href="/sales/orders"
              className="flex items-center gap-(--space-5) text-[length:var(--text-lg)] font-semibold tracking-[0] text-[var(--chrome-fg)]"
            >
              <AshicoreLogo showWordmark markClassName="size-(--space-10)" />
            </NavigationLink>
          </div>

          <ModuleNav
            modules={modules}
            visiblePathname={visiblePathname}
            visibleModule={visibleModule}
          />

          <div className="flex min-w-0 shrink-0 items-center gap-(--space-5) px-(--space-10) max-sm:gap-(--space-4) max-sm:px-(--space-6)">
            <Popover open={pageSearchOpen} onOpenChange={setPageSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="dashboard-page-search-trigger"
                  suppressHydrationWarning
                  type="button"
                  variant="outline"
                  className="h-(--height-topnav-control) gap-(--space-4) rounded-(--radius-full) border-[var(--chrome-line)] bg-transparent px-(--space-6) text-[length:var(--text-ui)] font-normal text-[var(--chrome-fg-soft)] hover:bg-[var(--chrome-line)] hover:text-[var(--chrome-fg)] data-[state=open]:bg-[var(--chrome-line)] data-[state=open]:text-[var(--chrome-fg)]"
                  aria-label="Search pages"
                >
                  <HugeiconsIcon
                    icon={Search01Icon}
                    strokeWidth={2}
                    className="size-(--space-9)"
                  />
                  <span className="max-sm:sr-only">Search</span>
                  <kbd className="max-sm:hidden rounded-(--radius-sm) border border-[var(--chrome-line)] bg-[var(--chrome-line)] px-(--space-2) py-px font-mono text-[length:var(--text-2xs)] leading-none text-[var(--chrome-fg-soft)]">
                    ⌘K
                  </kbd>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                id="dashboard-page-search-content"
                align="end"
                className="w-96 gap-(--space-4) rounded-(--radius-lg) bg-[var(--color-surface)] p-(--space-4) text-[var(--color-ink)] shadow-[var(--shadow-overlay)]"
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
                            <div className="mt-(--space-4) bg-[var(--color-surface-alt)] px-(--space-5) py-(--space-3) text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase first:mt-0">
                              {action.group}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className={cn(
                              "flex min-h-(--height-input-lg) w-full items-center gap-(--space-6) rounded-(--radius-md) px-(--space-5) py-(--space-4) text-left text-[length:var(--text-base)] outline-none hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] focus-visible:bg-[var(--color-accent-soft)] focus-visible:text-[var(--color-accent-ink)]",
                              active && "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
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
                              className="size-(--space-10) shrink-0 text-[var(--color-ink-faint)]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{action.title}</span>
                              <span className="block truncate text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                                {action.description}
                              </span>
                            </span>
                          </button>
                        </Fragment>
                      );
                    })
                  ) : (
                    <div className="px-(--space-5) py-(--space-12) text-center text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                      No pages found.
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {createActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    id="dashboard-create-menu-trigger"
                    type="button"
                    variant="default"
                    className="h-(--height-topnav-control) gap-(--space-4) rounded-(--radius-full) px-(--space-8) text-[length:var(--text-md)] font-semibold text-[var(--color-accent-text)] shadow-none max-sm:px-(--space-5)"
                  >
                    <HugeiconsIcon
                      icon={AddCircleIcon}
                      strokeWidth={2}
                      className="size-(--space-9)"
                    />
                    <span className="max-sm:sr-only">Create</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  id="dashboard-create-menu-content"
                  align="end"
                  className="min-w-72 rounded-(--radius-lg) bg-[var(--color-surface)] p-(--space-4) text-[var(--color-ink)] shadow-[var(--shadow-overlay)]"
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
                            className="size-(--space-10) text-[var(--color-ink-faint)]"
                          />
                          {action.title}
                        </NavigationLink>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id="dashboard-user-menu-trigger"
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-(--height-topnav-control) rounded-(--radius-full) text-[var(--chrome-fg)] hover:bg-[var(--chrome-line)] hover:text-[var(--chrome-fg)] data-[state=open]:bg-[var(--chrome-line)] data-[state=open]:text-[var(--chrome-fg)]"
                  aria-label="User menu"
                >
                  <Avatar className="size-(--height-topnav-control) ring-1 ring-[var(--chrome-line)]">
                    {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                    <AvatarFallback className="bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                id="dashboard-user-menu-content"
                align="end"
                className="min-w-72 bg-[var(--color-surface)] text-[var(--color-ink)]"
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-(--space-4) px-(--space-2) py-(--space-3) text-left text-[length:var(--text-sm)]">
                    <Avatar className="size-8">
                      {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-[length:var(--text-sm)] leading-[var(--leading-sm)]">
                      <span className="truncate font-medium">{user.name}</span>
                      <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                        {user.email}
                      </span>
                      <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
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
                            <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
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
                    <DropdownMenuLabel className="text-[length:var(--text-xs)] font-normal text-[var(--status-danger-ink)]">
                      {switchError}
                    </DropdownMenuLabel>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <NavigationLink href="/settings/account">
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
      {visibleModule ? (
        <nav
          aria-label={`${visibleModule.title} pages`}
          className="flex h-(--height-subnav) w-full min-w-0 shrink-0 items-center overflow-hidden border-b border-[var(--chrome-line)] bg-[var(--chrome-bg)] px-(--space-8) max-sm:px-(--space-6)"
        >
          <div className="flex min-w-0 flex-1 items-center gap-(--space-2) overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleModule.items.map((item) => {
              const active = isDashboardPathActive(visiblePathname, item.href);

              return (
                <NavigationLink
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-(--height-subnav) shrink-0 items-center px-(--space-5) text-[length:var(--text-md)] leading-[var(--leading-md)] font-medium text-[var(--chrome-fg-soft)] hover:text-[var(--chrome-fg)]",
                    active &&
                      "font-semibold text-[var(--chrome-fg)] shadow-[inset_0_-2px_0_var(--color-accent)]"
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
