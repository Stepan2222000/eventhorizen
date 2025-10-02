import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const navigation = [
  { name: 'Dashboard', href: '/', icon: 'fas fa-chart-line' },
  { name: 'Article Search', href: '/search', icon: 'fas fa-magnifying-glass' },
  { name: 'Add Movement', href: '/movement', icon: 'fas fa-plus-circle' },
  { name: 'Stock Levels', href: '/stock', icon: 'fas fa-warehouse' },
  { name: 'Movement History', href: '/history', icon: 'fas fa-clock-rotate-left' },
  { name: 'Bulk Import', href: '/import', icon: 'fas fa-file-import' },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <i className="fas fa-boxes-stacked text-white text-lg"></i>
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">SMART Inventory</h1>
            <p className="text-xs text-muted-foreground">Management System</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => (
          <Link key={item.href} href={item.href}>
            <a className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 hover:bg-accent",
              location === item.href 
                ? "bg-primary text-primary-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}>
              <i className={`${item.icon} w-5`}></i>
              <span>{item.name}</span>
            </a>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
          <div className="flex gap-2">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" style={{animationDelay: '0.2s'}}></div>
          </div>
          <div className="flex-1 text-xs">
            <div className="text-muted-foreground">DB Status</div>
            <div className="font-medium font-mono text-foreground">Connected</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
