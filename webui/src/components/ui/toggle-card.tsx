import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ToggleOption {
  key: string;
  label: string;
  description?: string;
}

interface ToggleCardProps {
  title: string;
  description?: string;
  options: ToggleOption[];
  defaultOption?: string;
  children: (activeOption: string, toggleButtons?: React.ReactNode) => React.ReactNode;
  className?: string;
  contentOnly?: boolean; // 新增：是否只渲染内容，不包装Card
}

export function ToggleCard({
  title,
  description,
  options,
  defaultOption,
  children,
  className,
  contentOnly = false
}: ToggleCardProps) {
  const [activeOption, setActiveOption] = useState(defaultOption || options[0]?.key || "");

  const toggleButtons = (
    <div className="flex rounded-lg border p-1 bg-muted/50">
      {options.map((option) => (
        <Button
          key={option.key}
          variant={activeOption === option.key ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveOption(option.key)}
          className={cn(
            "h-7 px-3 text-xs font-medium transition-all",
            activeOption === option.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={option.description}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );

  if (contentOnly) {
    return (
      <div className={cn("", className)}>
        {children(activeOption, toggleButtons)}
      </div>
    );
  }

  return (
    <Card className={cn("", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {toggleButtons}
        </div>
      </CardHeader>
      <CardContent>
        {children(activeOption)}
      </CardContent>
    </Card>
  );
}