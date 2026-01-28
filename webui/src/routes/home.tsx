"use client"

import { useState, useEffect, memo, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Loading from "@/components/loading";
import {
  getMetricsSummary,
  getModelOptions,
  getModelProviders,
  getProviders,
  getAuthKeySummary,
  getRequestAmountTrend
} from "@/lib/api";
import type { AuthKeySummary, MetricsSummary, RequestAmountSummary } from "@/lib/api";
import { toast } from "sonner";
import {
  RefreshCw,
  Activity,
  MessageSquare,
  Clock,
  BarChart3,
  BadgeCheck,
  ArrowDownToLine,
  ArrowUpToLine,
  CalendarDays,
  Coins,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

const cardHoverClass =
  "transition-all duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:shadow-md hover:border-primary/30";

const summaryCardClass =
  "relative min-h-[64px] overflow-hidden rounded-[20px] border border-border/50 bg-card/80 shadow-[0_6px_18px_rgba(0,0,0,0.08)] backdrop-blur-sm";

const summarySideTitleClass =
  "text-[9px] font-semibold tracking-[0.22em] text-muted-foreground/80";

const summaryTitleIconClass =
  "size-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 ring-1 ring-emerald-100/80 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20";

const summaryMetricIconClass =
  "size-6 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 ring-1 ring-emerald-100/80 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20";

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

const AUTH_KEY_PREFIX = "sk-github.com/racio/llmio-";

const formatFixedNumber = (value: number | null | undefined, digits = 2) => {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  return value.toFixed(digits);
};

const formatMoney = (value: number | null | undefined, digits = 2) => {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  return `$${value.toFixed(digits)}`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toISOString().slice(0, 10);
};

const formatSeconds = (valueMs: number | null | undefined) => {
  if (valueMs == null || !Number.isFinite(valueMs)) {
    return "--";
  }
  return `${(valueMs / 1000).toFixed(2)} s`;
};


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
        <div className="w-11 shrink-0 flex flex-col items-center justify-center gap-1 py-1">
          <span className={summaryTitleIconClass} aria-hidden="true">
            <TitleIcon className="size-3.5" />
          </span>
          <span
            className={summarySideTitleClass}
            style={{ writingMode: "vertical-rl" }}
          >
            {title}
          </span>
        </div>
        <div className="w-px bg-border/60 my-1.5" />
        <div className="flex-1 grid grid-rows-2 gap-0.5 px-1.5 py-0.5">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className={summaryMetricIconClass} aria-hidden="true">
                <item.icon className="size-3" />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground">{item.label}</div>
                <div className="text-[13px] font-semibold leading-tight">{item.value}</div>
                {item.subLabel && (
                  <div className="text-[9px] text-muted-foreground">
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

const buildCurvePoints = (data: number[], width: number, height: number) => {
  if (data.length < 2) return [];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  return data.map((value, index) => {
    const x = step * index;
    const y = height - ((value - min) / range) * height;
    return { x, y };
  });
};

type RequestAmountCardProps = {
  requestLabel: string;
  requestValue: string;
  amountLabel: string;
  amountValue: string;
  rangeLabel: string;
  rangeValue: string;
  curveData: number[];
};

const requestAmountCurveData = [0, 2, 6, 4, 7, 3, 5, 2, 6, 4, 5, 8, 3, 6, 5, 7];

const buildAreaCurve = (data: number[], width: number, height: number) => {
  const points = buildCurvePoints(data, width, height);
  if (points.length === 0) return { line: "", area: "" };
  const line = buildSmoothLine(points);
  const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${height} L ${points[0].x.toFixed(2)} ${height} Z`;
  return { line, area };
};

const buildSmoothLine = (points: { x: number; y: number }[]) => {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }
  const tension = 1;
  const path: string[] = [`M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
    const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
    const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
    const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

    path.push(
      `C${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    );
  }
  return path.join(" ");
};

const RequestAmountCard = ({
  requestLabel,
  requestValue,
  amountLabel,
  amountValue,
  rangeLabel,
  rangeValue,
  curveData,
}: RequestAmountCardProps) => {
  const chartWidth = 520;
  const chartHeight = 120;
  const chart = buildAreaCurve(curveData, chartWidth, chartHeight);

  return (
    <Card className={`${cardHoverClass} gap-3 lg:col-span-2`}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
            <div className="flex flex-col gap-1">
              <span>{requestLabel}</span>
              <span className="text-lg font-semibold text-foreground">{requestValue}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span>{amountLabel}</span>
              <span className="text-lg font-semibold text-foreground">{amountValue}</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="mr-1">{rangeLabel}</span>
            <span className="text-foreground">{rangeValue}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card/60 px-4 py-3">
          <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 10% 20%, rgba(34,197,94,0.28), transparent 55%)" }} />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>0:00</span>
            <span>4:00</span>
            <span>8:00</span>
            <span>12:00</span>
            <span>16:00</span>
          </div>
          <div className="mt-2">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-28 w-full">
              <path d={chart.area} className="fill-emerald-200/60" />
              <path d={chart.line} className="stroke-emerald-600" fill="none" strokeWidth="2" />
            </svg>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

type AuthKeyDashboardProps = {
  summary: AuthKeySummary | null;
  errorMessage?: string | null;
};

const AuthKeyDashboard = ({ summary, errorMessage }: AuthKeyDashboardProps) => {
  const name = summary?.name?.trim() || "未命名";
  const keyMasked = summary?.keyMasked || "--";
  const expiresAt = formatDate(summary?.expiresAt);
  const expireInDays = summary?.expireInDays;
  const expireText = summary?.expiresAt
    ? `${expireInDays ?? 0} 天后到期`
    : "长期有效";
  const totalCost = summary?.totalCost ?? 0;
  const costMax = Math.max(totalCost, 30);
  const costProgress = costMax > 0 ? Math.min(totalCost / costMax, 1) : 0;
  const allowedModels = summary?.allowAll ? ["全部模型"] : (summary?.models || []);

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="py-6 text-sm text-muted-foreground">
            {errorMessage}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">名称</div>
                <div className="mt-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm font-mono">
                  {keyMasked}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{name}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>过期时间</span>
              <span className="text-foreground">{expiresAt}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                {expireText}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-muted-foreground">消耗费用</div>
                <div className="mt-1 text-4xl font-semibold text-emerald-600">
                  {formatMoney(summary?.totalCost)}
                </div>
              </div>
              <Coins className="size-8 text-muted-foreground/40" />
            </div>
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-muted/50">
                <div
                  className="h-2 rounded-full bg-emerald-500/70"
                  style={{ width: `${costProgress * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>0</span>
                <span>{formatMoney(costMax)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-500" />
              成功请求
            </div>
            <div className="text-xl font-semibold">{formatFixedNumber(summary?.successRequests)}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <XCircle className="size-4 text-rose-500" />
              失败请求
            </div>
            <div className="text-xl font-semibold">{formatFixedNumber(summary?.failureRequests)}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="size-4 text-emerald-500" />
              请求次数
            </div>
            <div className="text-xl font-semibold">{formatFixedNumber(summary?.totalRequests)}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-4 text-amber-500" />
              消耗时间
            </div>
            <div className="text-xl font-semibold">{formatSeconds(summary?.totalTimeMs)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ArrowDownToLine className="size-4 text-emerald-600" />
                消耗 Token
              </div>
              <div className="text-sm font-semibold">
                {formatFixedNumber(summary?.totalTokens)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div className="space-y-1">
                <div>输入 Tokens</div>
                <div className="text-base font-semibold text-foreground">
                  {formatFixedNumber(summary?.promptTokens)}
                </div>
              </div>
              <div className="space-y-1">
                <div>输出 Tokens</div>
                <div className="text-base font-semibold text-foreground">
                  {formatFixedNumber(summary?.completionTokens)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Coins className="size-4 text-emerald-600" />
                消耗费用
              </div>
              <div className="text-sm font-semibold">
                {formatMoney(summary?.totalCost)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div className="space-y-1">
                <div>输入费用</div>
                <div className="text-base font-semibold text-foreground">
                  {formatMoney(summary?.inputCost)}
                </div>
              </div>
              <div className="space-y-1">
                <div>输出费用</div>
                <div className="text-base font-semibold text-foreground">
                  {formatMoney(summary?.outputCost)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BadgeCheck className="size-4 text-emerald-600" />
            支持的模型
          </div>
          {allowedModels.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {allowedModels.map((model) => (
                <Badge key={model} variant="secondary" className="rounded-full">
                  {model}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">暂无模型</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const defaultRequestAmount: RequestAmountSummary = {
  total_requests: 0,
  total_amount: 0,
  range: "today",
  points: [],
};

const formatCompactValue = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  const format = (num: number, suffix: string) => {
    const fixed = num.toFixed(2).replace(/\.?0+$/, "");
    return `${fixed}${suffix}`;
  };
  if (abs >= 1_000_000) return format(value / 1_000_000, "M");
  if (abs >= 1_000) return format(value / 1_000, "k");
  return value.toString();
};

const formatAmountValue = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(2).replace(/\.?0+$/, "");
};

type HomeHeaderProps = {
  title: string;
  onRefresh: () => void;
};

const HomeHeader = memo(({ title, onRefresh }: HomeHeaderProps) => {
  return (
    <div className="flex flex-col gap-2 flex-shrink-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
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
  const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<Record<ProviderTypeKey, string[]>>(() =>
    createEmptyAvailableModels()
  );
  const [requestAmount, setRequestAmount] = useState<RequestAmountSummary>(defaultRequestAmount);
  const [authKeySummary, setAuthKeySummary] = useState<AuthKeySummary | null>(null);
  const [authKeyError, setAuthKeyError] = useState<string | null>(null);
  const [authKeyMode, setAuthKeyMode] = useState(false);

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

  const fetchAuthKeySummary = useCallback(async () => {
    try {
      const data = await getAuthKeySummary();
      setAuthKeySummary(data);
      setAuthKeyError(null);
      return true;
    } catch (err) {
      setAuthKeySummary(null);
      const message = err instanceof Error ? err.message : String(err);
      setAuthKeyError(`获取 API Key 概览失败: ${message}`);
      return false;
    }
  }, []);
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

  const fetchRequestAmount = useCallback(async () => {
    try {
      const data = await getRequestAmountTrend();
      setRequestAmount(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取请求金额趋势失败: ${message}`);
      console.error(err);
      setRequestAmount(defaultRequestAmount);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem("authToken")?.trim() || "";
    const isAuthKeyToken = token.startsWith(AUTH_KEY_PREFIX);

    if (isAuthKeyToken) {
      setAuthKeyMode(true);
      await fetchAuthKeySummary();
      setLoading(false);
      return;
    }

    setAuthKeyMode(false);
    setAuthKeySummary(null);
    setAuthKeyError(null);
    await Promise.all([fetchSummary(), fetchRequestAmount()]);
    setLoading(false);
    void fetchAvailableModels();
  }, [fetchAuthKeySummary, fetchAvailableModels, fetchRequestAmount, fetchSummary]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestCurveData = requestAmount.points.length > 0
    ? requestAmount.points.map((point) => point.requests)
    : requestAmountCurveData;
  const requestValue = formatCompactValue(requestAmount.total_requests);
  const amountValue = formatAmountValue(requestAmount.total_amount);
  const rangeValue = requestAmount.range === "today" ? "今天" : requestAmount.range;

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 p-1">
      <HomeHeader
        title={authKeyMode ? "API Key 概览" : "系统概览"}
        onRefresh={() => void load()}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loading message={authKeyMode ? "加载 API Key 概览" : "加载系统概览"} />
          </div>
        ) : authKeyMode ? (
          <AuthKeyDashboard summary={authKeySummary} errorMessage={authKeyError} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard
                title="请求统计"
                icon={Activity}
                items={[
                  {
                    label: "请求次数",
                    value: <AnimatedCounter value={summary.totalReqs} className="text-base" />,
                    icon: MessageSquare,
                  },
                  {
                    label: "今日请求",
                    value: <AnimatedCounter value={summary.todayReqs} className="text-base" />,
                    icon: Clock,
                  },
                ]}
              />

              <SummaryCard
                title="成功统计"
                icon={BarChart3}
                items={[
                  {
                    label: "成功率",
                    value: <span className="text-base font-semibold">{summary.successRate.toFixed(2)}%</span>,
                    icon: BadgeCheck,
                  },
                  {
                    label: "成功请求",
                    value: <AnimatedCounter value={summary.totalSuccessReqs} className="text-base" />,
                    subLabel: `失败 ${summary.totalFailureReqs.toLocaleString()}`,
                    icon: ArrowUpToLine,
                  },
                ]}
              />

              <SummaryCard
                title="令牌统计"
                icon={ArrowDownToLine}
                items={[
                  {
                    label: "输入 Tokens",
                    value: <AnimatedCounter value={summary.promptTokens} className="text-base" />,
                    icon: ArrowDownToLine,
                  },
                  {
                    label: "输出 Tokens",
                    value: <AnimatedCounter value={summary.completionTokens} className="text-base" />,
                    icon: ArrowUpToLine,
                  },
                ]}
              />

              <SummaryCard
                title="今日统计"
                icon={CalendarDays}
                items={[
                  {
                    label: "今日成功率",
                    value: <span className="text-base font-semibold">{summary.todaySuccessRate.toFixed(2)}%</span>,
                    icon: BadgeCheck,
                  },
                  {
                    label: "今日成功",
                    value: <AnimatedCounter value={summary.todaySuccessReqs} className="text-base" />,
                    subLabel: `失败 ${summary.todayFailureReqs.toLocaleString()}`,
                    icon: ArrowUpToLine,
                  },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-start">
              <RequestAmountCard
                requestLabel="请求次数"
                requestValue={requestValue}
                amountLabel="金额($)"
                amountValue={amountValue}
                rangeLabel="时间范围"
                rangeValue={rangeValue}
                curveData={requestCurveData}
              />

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
