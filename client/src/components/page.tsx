import * as React from "react";

import { cn } from "@/lib/utils";

type PageProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
};

export function Page({ title, description, actions, children, className, containerClassName }: PageProps) {
  return (
    <div className={cn("p-6 md:p-8", className)}>
      <div className={cn("mx-auto w-full max-w-7xl", containerClassName)}>
        {(title || description || actions) && (
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              {title && (
                <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {title}
                </h1>
              )}
              {description && (
                <p className="text-xs text-muted-foreground sm:text-sm">{description}</p>
              )}
            </div>
            {actions && (
              <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
                {actions}
              </div>
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
