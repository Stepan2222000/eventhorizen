import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  BookOpen,
  DatabaseZap,
  FileUp,
  History,
  LayoutDashboard,
  Package,
  PackageX,
  PlusCircle,
  ShoppingCart,
  Trophy,
  Users,
  Warehouse,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navigation: NavItem[] = [
  { title: "Главная", href: "/", icon: LayoutDashboard },
  { title: "Добавить движение", href: "/movement", icon: PlusCircle },
  { title: "Клиенты", href: "/customers", icon: Users },
  { title: "Остатки", href: "/stock", icon: Warehouse },
  { title: "Экземпляры", href: "/items", icon: Package },
  { title: "Коробки", href: "/boxes", icon: Package },
  { title: "История движений", href: "/history", icon: History },
  { title: "Заказы", href: "/orders", icon: ShoppingCart },
  { title: "Распроданные товары", href: "/sold-out", icon: PackageX },
  { title: "Топ запчастей", href: "/top-parts", icon: BarChart3 },
  { title: "Массовая загрузка", href: "/import", icon: FileUp },
  { title: "SMART Каталог", href: "/smart-catalog", icon: BookOpen },
];

export function AppSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const [location] = useLocation();
  const { data: dbHealth, isLoading: dbLoading } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/health/db"],
    refetchInterval: 15_000,
    retry: false,
  });
  const dbConnected = dbHealth?.connected === true;

  return (
    <Sidebar
      collapsible="offcanvas"
      className={cn("border-r", className)}
      {...props}
    >
      <SidebarHeader className="border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="SMART Инвентаризация" className="hover:bg-transparent active:bg-transparent">
              <Link href="/">
                <div className="flex aspect-square size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm ring-1 ring-border/40">
                  <Trophy className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">SMART Инвентаризация</span>
                  <span className="truncate text-xs text-muted-foreground">Система учета</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-2">
          <SidebarGroupLabel className="px-2 text-[11px] font-semibold tracking-wide text-muted-foreground/80">
            Навигация
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "group relative h-10 rounded-lg px-2.5",
                        "hover:bg-muted/40 active:bg-muted/50",
                        "data-[active=true]:bg-gradient-to-r data-[active=true]:from-primary/12 data-[active=true]:to-transparent data-[active=true]:shadow-sm",
                        "data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:h-5 data-[active=true]:before:w-1 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:rounded-r-full data-[active=true]:before:bg-primary",
                      )}
                    >
                      <Link href={item.href}>
                        <span
                          className={cn(
                            "flex size-8 items-center justify-center rounded-md ring-1 ring-border/50 transition-colors",
                            isActive
                              ? "bg-primary/12 text-primary"
                              : "bg-muted/30 text-muted-foreground group-hover:bg-muted/50 group-hover:text-foreground"
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className={cn("truncate text-[13px]", isActive && "text-foreground")}>
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <div className="rounded-xl border bg-gradient-to-b from-muted/40 to-transparent px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "relative flex size-8 items-center justify-center rounded-lg ring-1",
                dbConnected
                  ? "bg-success/10 text-success ring-success/20"
                  : "bg-destructive/10 text-destructive ring-destructive/20"
              )}
            >
              <DatabaseZap className="size-4" />
              <span className="absolute -right-0.5 -top-0.5 flex size-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-40",
                    dbConnected ? "bg-success" : "bg-destructive"
                  )}
                />
                <span className={cn("relative inline-flex size-2 rounded-full", dbConnected ? "bg-success" : "bg-destructive")} />
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] leading-4 text-muted-foreground">Статус БД</div>
              <div className="truncate font-mono text-xs font-medium text-foreground">
                {dbLoading ? "Проверка..." : dbConnected ? "Подключено" : "Нет соединения"}
              </div>
            </div>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
