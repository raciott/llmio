"use client"

import { useState, useEffect, Suspense, lazy, memo, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Loading from "@/components/loading";
import {
  getMetricsSummary,
  getModelCounts,
  getModelOptions,
  getModelProviders,
  getProjectCounts,
  getProviders
} from "@/lib/api";
import type { MetricsSummary, ModelCount, ProjectCount } from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw, Layers, BadgeCheck, KeyRound, CalendarDays, ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";

const cardHoverClass =
  "transition-all duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:shadow-md hover:border-primary/30";

const summaryCardClass =
  "relative min-h-[93px] overflow-hidden rounded-[24px] border border-border/50 bg-card/80 shadow-[0_8px_22px_rgba(0,0,0,0.08)] backdrop-blur-sm";

const summarySideTitleClass =
  "text-[10px] font-semibold tracking-[0.28em] text-muted-foreground";

const summaryItemIconClass =
  "size-9 rounded-2xl bg-muted/60 text-primary flex items-center justify-center shrink-0";

const providerTypeOrder = ["anthropic", "openai", "openai_res"] as const;
type ProviderTypeKey = typeof providerTypeOrder[number];

const providerTypeLabels: Record<ProviderTypeKey, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openai_res: "Codex",
};

const createEmptyAvailableModels = (): Record<ProviderTypeKey, string[]> => ({
  anthropic: [],
  openai: [],
  openai_res: [],
});

const isModelEnabled = (value?: number | null): boolean =>
  value == null ? true : Number(value) === 1;

const normalizeProviderType = (raw: string): ProviderTypeKey | null => {
  const lower = (raw || "").trim().toLowerCase();
  if (!lower) return null;
  if (lower === "codex") return "openai_res";
  if (providerTypeOrder.includes(lower as ProviderTypeKey)) {
    return lower as ProviderTypeKey;
  }
  return null;
};

type ChartView = "pie" | "ranking";

const SegmentedToggle = ({
  value,
  onChange,
}: {
  value: ChartView;
  onChange: (v: ChartView) => void;
}) => {
  return (
    <div className="flex rounded-lg border p-1 bg-muted/50">
      <Button
        variant={value === "pie" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChange("pie")}
        className={[
          "h-7 px-3 text-xs font-medium transition-all",
          value === "pie"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        ].join(" ")}
        title="占比"
      >
        占比
      </Button>
      <Button
        variant={value === "ranking" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChange("ranking")}
        className={[
          "h-7 px-3 text-xs font-medium transition-all",
          value === "ranking"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        ].join(" ")}
        title="排行"
      >
        排行
      </Button>
    </div>
  );
};

// 懒加载图表组件
const ChartPieDonutText = lazy(() => import("@/components/charts/pie-chart").then(module => ({ default: module.ChartPieDonutText })));
const ModelRankingChart = lazy(() => import("@/components/charts/bar-chart").then(module => ({ default: module.ModelRankingChart })));
const ProjectChartPieDonutText = lazy(() => import("@/components/charts/project-pie-chart").then(module => ({ default: module.ProjectChartPieDonutText })));
const ProjectRankingChart = lazy(() => import("@/components/charts/project-bar-chart").then(module => ({ default: module.ProjectRankingChart })));

// Animated counter component
const AnimatedCounter = ({
  value,
  duration = 1000,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number | null = null;
    const animateCount = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const progressRatio = Math.min(progress / duration, 1);
      const currentValue = Math.floor(progressRatio * value);

      setCount(currentValue);

      if (progress < duration) {
        requestAnimationFrame(animateCount);
      }
    };

    requestAnimationFrame(animateCount);
  }, [value, duration]);

  return (
    <div className={["text-3xl font-bold", className].filter(Boolean).join(" ")}>
      {count.toLocaleString()}
    </div>
  );
};

type SummaryMetric = {
  label: string;
  value: React.ReactNode;
  subLabel?: string;
  icon: LucideIcon;
};

type SummaryCardProps = {
  title: string;
  icon: LucideIcon;
  items: [SummaryMetric, SummaryMetric];
};

const SummaryCard = ({ title, icon: TitleIcon, items }: SummaryCardProps) => {
  return (
    <Card className={summaryCardClass}>
      <div className="flex h-full">
        <div className="w-14 shrink-0 flex flex-col items-center justify-center gap-2 py-1">
          <span className={summaryItemIconClass} aria-hidden="true">
            <TitleIcon className="size-4.5" />
          </span>
          <span
            className={summarySideTitleClass}
            style={{ writingMode: "vertical-rl" }}
          >
            {title}
          </span>
        </div>
        <div className="w-px bg-border/60 my-2" />
        <div className="flex-1 grid grid-rows-2 gap-2 px-1 py-1">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span className={summaryItemIconClass} aria-hidden="true">
                <item.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-lg font-semibold leading-tight">{item.value}</div>
                {item.subLabel && (
                  <div className="text-xs text-muted-foreground">
                    {item.subLabel}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

type HomeHeaderProps = {
  onRefresh: () => void;
};

const HomeHeader = memo(({ onRefresh }: HomeHeaderProps) => {
  return (
    <div className="flex flex-col gap-2 flex-shrink-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">系统概览</h2>
        </div>
        <Button
          onClick={onRefresh}
          variant="outline"
          size="icon"
          className="ml-auto shrink-0"
          aria-label="刷新概览"
          title="刷新概览"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
    </div>
  );
});

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [modelView, setModelView] = useState<ChartView>("pie");
  const [projectView, setProjectView] = useState<ChartView>("pie");
  const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<Record<ProviderTypeKey, string[]>>(() =>
    createEmptyAvailableModels()
  );

  // Real data from APIs
  const [summary, setSummary] = useState<MetricsSummary>({
    totalReqs: 0,
    successRate: 0,
    promptTokens: 0,
    completionTokens: 0,
    todayReqs: 0,
    todaySuccessRate: 0,
    todaySuccessReqs: 0,
    todayFailureReqs: 0,
    totalSuccessReqs: 0,
    totalFailureReqs: 0,
  });
  const [modelCounts, setModelCounts] = useState<ModelCount[]>([]);
  const [projectCounts, setProjectCounts] = useState<ProjectCount[]>([]);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await getMetricsSummary();
      setSummary(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取系统概览失败: ${message}`);
      console.error(err);
    }
  }, []);

  const fetchModelCounts = useCallback(async () => {
    try {
      const data = await getModelCounts();
      setModelCounts(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取图表数据失败: ${message}`);
      console.error(err);
    }
  }, []);

  const fetchProjectCounts = useCallback(async () => {
    try {
      const data = await getProjectCounts();
      setProjectCounts(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取图表数据失败: ${message}`);
      console.error(err);
    }
  }, []);

  const fetchAvailableModels = useCallback(async () => {
    setAvailableModelsLoading(true);
    try {
      const [providers, modelOptions] = await Promise.all([getProviders(), getModelOptions()]);
      const providerTypeById = new Map<number, ProviderTypeKey>();

      providers.forEach((provider) => {
        const type = normalizeProviderType(provider.Type || "");
        if (!type) return;
        providerTypeById.set(provider.ID, type);
      });

      const activeModels = modelOptions.filter((model) => isModelEnabled(model.Status));
      const modelProvidersList = await Promise.all(
        activeModels.map(async (model) => {
          try {
            const data = await getModelProviders(model.ID);
            const enabled = data.filter((item) => item.Status == null || item.Status);
            return { model, providers: enabled };
          } catch (err) {
            console.error("获取模型关联提供商失败", err);
            return { model, providers: [] };
          }
        })
      );

      const grouped: Record<ProviderTypeKey, Set<string>> = {
        anthropic: new Set(),
        openai: new Set(),
        openai_res: new Set(),
      };

      modelProvidersList.forEach(({ model, providers }) => {
        const name = (model.Name || "").trim();
        if (!name) return;
        const typeSet = new Set<ProviderTypeKey>();
        providers.forEach((provider) => {
          const type = providerTypeById.get(provider.ProviderID);
          if (type) typeSet.add(type);
        });
        typeSet.forEach((type) => grouped[type].add(name));
      });

      const next = createEmptyAvailableModels();
      providerTypeOrder.forEach((type) => {
        next[type] = Array.from(grouped[type]).sort((a, b) => a.localeCompare(b));
      });

      setAvailableModels(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取可用模型失败: ${message}`);
      console.error(err);
      setAvailableModels(createEmptyAvailableModels());
    } finally {
      setAvailableModelsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSummary(), fetchModelCounts(), fetchProjectCounts()]);
    setLoading(false);
    void fetchAvailableModels();
  }, [fetchAvailableModels, fetchModelCounts, fetchProjectCounts, fetchSummary]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 p-1">
      <HomeHeader onRefresh={() => void load()} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loading message="加载系统概览" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="请求统计"
                icon={Layers}
                items={[
                  {
                    label: "请求次数",
                    value: <AnimatedCounter value={summary.totalReqs} className="text-xl" />,
                    icon: Layers,
                  },
                  {
                    label: "今日请求",
                    value: <AnimatedCounter value={summary.todayReqs} className="text-xl" />,
                    icon: CalendarDays,
                  },
                ]}
              />

              <SummaryCard
                title="成功统计"
                icon={BadgeCheck}
                items={[
                  {
                    label: "成功率",
                    value: <span className="text-xl font-semibold">{summary.successRate.toFixed(2)}%</span>,
                    icon: BadgeCheck,
                  },
                  {
                    label: "成功请求",
                    value: <AnimatedCounter value={summary.totalSuccessReqs} className="text-xl" />,
                    subLabel: `失败 ${summary.totalFailureReqs.toLocaleString()}`,
                    icon: ArrowUp,
                  },
                ]}
              />

              <SummaryCard
                title="令牌统计"
                icon={KeyRound}
                items={[
                  {
                    label: "输入 Tokens",
                    value: <AnimatedCounter value={summary.promptTokens} className="text-xl" />,
                    icon: ArrowDown,
                  },
                  {
                    label: "输出 Tokens",
                    value: <AnimatedCounter value={summary.completionTokens} className="text-xl" />,
                    icon: ArrowUp,
                  },
                ]}
              />

              <SummaryCard
                title="今日统计"
                icon={CalendarDays}
                items={[
                  {
                    label: "今日成功率",
                    value: <span className="text-xl font-semibold">{summary.todaySuccessRate.toFixed(2)}%</span>,
                    icon: BadgeCheck,
                  },
                  {
                    label: "今日成功",
                    value: <AnimatedCounter value={summary.todaySuccessReqs} className="text-xl" />,
                    subLabel: `失败 ${summary.todayFailureReqs.toLocaleString()}`,
                    icon: Layers,
                  },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-start">
              {/* 模型统计卡片：占比/排行按钮放到卡片右上角，隐藏额外标题文案 */}
              <Card className={`${cardHoverClass} gap-3`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">按模型统计</div>
                    <SegmentedToggle value={modelView} onChange={setModelView} />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Suspense
                    fallback={
                      <div className="h-64 flex items-center justify-center">
                        <Loading message="加载图表..." />
                      </div>
                    }
                  >
                    {modelView === "pie" ? (
                      <ChartPieDonutText data={modelCounts} embedded />
                    ) : (
                      <ModelRankingChart data={modelCounts} embedded />
                    )}
                  </Suspense>
                </CardContent>
              </Card>

              {/* 项目统计卡片：占比/排行按钮放到卡片右上角，隐藏额外标题文案 */}
              <Card className={`${cardHoverClass} gap-3`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">按项目统计</div>
                    <SegmentedToggle value={projectView} onChange={setProjectView} />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Suspense
                    fallback={
                      <div className="h-64 flex items-center justify-center">
                        <Loading message="加载图表..." />
                      </div>
                    }
                  >
                    {projectView === "pie" ? (
                      <ProjectChartPieDonutText data={projectCounts} embedded />
                    ) : (
                      <ProjectRankingChart data={projectCounts} embedded />
                    )}
                  </Suspense>
                </CardContent>
              </Card>

              <Card className={`${cardHoverClass} gap-3 lg:col-span-2`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">当前可用模型</div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {availableModelsLoading ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">加载中...</div>
                  ) : (
                    <div className="grid gap-3">
                      {providerTypeOrder.map((type) => {
                        const models = availableModels[type];
                        return (
                          <div key={type} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-muted-foreground">
                                {providerTypeLabels[type]}
                              </span>
                              <span className="text-xs text-muted-foreground">{models.length} 个</span>
                            </div>
                            {models.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {models.map((model) => (
                                  <Badge
                                    key={`${type}-${model}`}
                                    variant="secondary"
                                    className="bg-muted/60 text-foreground"
                                  >
                                    {model}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">暂无可用模型</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
