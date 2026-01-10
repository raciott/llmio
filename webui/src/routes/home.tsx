"use client"

import { useState, useEffect, Suspense, lazy, memo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Loading from "@/components/loading";
import {
  getMetricsSummary,
  getModelCounts,
  getProjectCounts
} from "@/lib/api";
import type { MetricsSummary, ModelCount, ProjectCount } from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw, Layers, BadgeCheck, KeyRound, CalendarDays, ArrowDown, ArrowUp } from "lucide-react";

const cardHoverClass =
  "transition-all duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:shadow-md hover:border-primary/30";

const cardIconWrapClass =
  "size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0";

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
const AnimatedCounter = ({ value, duration = 1000 }: { value: number; duration?: number }) => {
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

  return <div className="text-3xl font-bold">{count.toLocaleString()}</div>;
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

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSummary(), fetchModelCounts(), fetchProjectCounts()]);
    setLoading(false);
  }, [fetchModelCounts, fetchProjectCounts, fetchSummary]);

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
              <Card className={cardHoverClass}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>请求总数</CardTitle>
                    <div className={cardIconWrapClass} aria-hidden="true">
                      <Layers className="size-5" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between gap-3">
                    <AnimatedCounter value={summary.totalReqs} />
                    <div className="text-xs text-muted-foreground pb-1">累计</div>
                  </div>
                </CardContent>
              </Card>

              <Card className={cardHoverClass}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>请求成功率</CardTitle>
                    <div className={cardIconWrapClass} aria-hidden="true">
                      <BadgeCheck className="size-5" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{summary.successRate.toFixed(2)}%</div>
                  <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-green-500 transition-[width] duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, summary.successRate))}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    成功 {summary.totalSuccessReqs.toLocaleString()} · 失败 {summary.totalFailureReqs.toLocaleString()}
                  </div>
                </CardContent>
              </Card>

              <Card className={cardHoverClass}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>令牌统计</CardTitle>
                    <div className={cardIconWrapClass} aria-hidden="true">
                      <KeyRound className="size-5" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <ArrowDown className="size-3" />
                        输入
                      </div>
                      <AnimatedCounter value={summary.promptTokens} />
                    </div>
                    <div className="text-muted-foreground text-2xl leading-none">｜</div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <ArrowUp className="size-3" />
                        输出
                      </div>
                      <AnimatedCounter value={summary.completionTokens} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className={cardHoverClass}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>今日请求数</CardTitle>
                    <div className={cardIconWrapClass} aria-hidden="true">
                      <CalendarDays className="size-5" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <AnimatedCounter value={summary.todayReqs} />
                  <div className="mt-1 text-xs text-muted-foreground">
                    成功率 {summary.todaySuccessRate.toFixed(2)}%
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
