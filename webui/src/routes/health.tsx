import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import Loading from "@/components/loading";
import { getSystemHealthDetail, getProviders, type Provider, type SystemHealth, type ProviderHealth, type ModelHealth } from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertCircle, XCircle, Activity, Database, HardDrive, Server, Clock, ChevronDown, ChevronRight, Zap, Radio } from "lucide-react";

const providerCardHoverClass =
  "relative transition-all duration-300 ease-out will-change-transform transform-gpu " +
  "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10 hover:border-primary/25 " +
  "active:translate-y-0 " +
  "motion-reduce:transition-none motion-reduce:hover:transform-none " +
  "after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-[2px] " +
  "after:bg-gradient-to-r after:from-transparent after:via-primary/40 after:to-transparent " +
  "after:opacity-0 after:transition-opacity after:duration-300 hover:after:opacity-100";

const modelCardHoverClass =
  "relative overflow-hidden transition-all duration-300 ease-out will-change-transform transform-gpu " +
  "hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10 hover:border-primary/25 " +
  "active:translate-y-0 " +
  "motion-reduce:transition-none motion-reduce:hover:transform-none " +
  "after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-[2px] " +
  "after:bg-gradient-to-r after:from-transparent after:via-primary/40 after:to-transparent " +
  "after:opacity-0 after:transition-opacity after:duration-300 hover:after:opacity-100";

// 状态指示器组件
const StatusBadge = ({ status }: { status: "healthy" | "degraded" | "unhealthy" | "unknown" }) => {
  const variants = {
    healthy: { icon: <CheckCircle2 className="size-3" />, label: "正常", className: "bg-green-500 text-white hover:bg-green-500/90" },
    degraded: { icon: <AlertCircle className="size-3" />, label: "警告", className: "bg-yellow-500 text-white hover:bg-yellow-500/90" },
    unhealthy: { icon: <XCircle className="size-3" />, label: "异常", className: "bg-red-500 text-white hover:bg-red-500/90" },
    unknown: { icon: <Activity className="size-3" />, label: "未知", className: "bg-gray-500 text-white hover:bg-gray-500/90" }
  };

  const config = variants[status];

  return (
    <Badge className={cn("flex items-center gap-1", config.className)}>
      {config.icon}
      {config.label}
    </Badge>
  );
};

// 格式化运行时间
const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
};

// 基于后端返回的 firstDeployTime 计算系统运行时间（秒）。
// 优先使用后端的时间戳，避免本地时钟偏差影响显示。
const calcUptimeFromFirstDeployTime = (health: SystemHealth): number => {
  const base = Date.parse(health.firstDeployTime);
  const now = Date.parse(health.timestamp);
  if (Number.isNaN(base) || Number.isNaN(now)) return health.uptime;
  return Math.max(0, Math.floor((now - base) / 1000));
};

// 格式化响应时间
const formatResponseTime = (ms: number): string => {
  if (ms < 1) return "< 1ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

type ConsoleLatencyState =
  | { status: "na" }
  | { status: "loading" }
  | { status: "ok"; ms: number; checkedAt: number }
  | { status: "error"; message: string; checkedAt: number };

const withNoCachePing = (rawUrl: string): string | null => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    url.searchParams.set("_llmio_ping", Date.now().toString());
    return url.toString();
  } catch {
    return null;
  }
};

const probeConsoleLatencyMs = async (consoleUrl: string, signal?: AbortSignal): Promise<number> => {
  const start = performance.now();
  // no-cors：跨域控制台一般没有 CORS，这里只关心“能否连通 + 耗时”，不读取响应内容
  await fetch(consoleUrl, {
    method: "GET",
    mode: "no-cors",
    cache: "no-store",
    credentials: "omit",
    redirect: "follow",
    signal,
  });
  return Math.max(0, Math.round(performance.now() - start));
};

const humanProviderType = (raw: string): string => {
  const v = (raw || "").trim();
  if (!v) return "-";
  const lower = v.toLowerCase();
  if (lower === "openai") return "OpenAI";
  if (lower === "anthropic") return "Anthropic";
  if (lower === "gemini") return "Gemini";
  return v.charAt(0).toUpperCase() + v.slice(1);
};

// 模型健康状态卡片（用于“提供商与模型详情”内嵌展示）
const ModelHealthCard = ({
  provider,
  model,
  consoleLatency,
}: {
  provider: ProviderHealth;
  model: ModelHealth;
  consoleLatency: ConsoleLatencyState;
}) => {
  const blocks = model.requestBlocks.slice(-60);
  const pingText = consoleLatency.status === "ok" ? `${consoleLatency.ms} ms` : "-";

  return (
    <Card className={cn("overflow-hidden", modelCardHoverClass)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="size-10 rounded-full border bg-background flex items-center justify-center text-sm font-semibold shrink-0">
              AI
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{model.modelName}</div>
              <div className="text-xs text-muted-foreground truncate">
                {humanProviderType(provider.type)} &nbsp; {model.providerModel}
              </div>
            </div>
          </div>
          <StatusBadge status={model.status} />
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="size-3" />
              对话延迟
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {model.avgResponseTimeMs > 0 ? `${Math.round(model.avgResponseTimeMs)} ms` : "-"}
            </div>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Radio className="size-3" />
              端点 PING
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{pingText}</div>
          </div>
        </div>

        <div className="border-t pt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">近期可用性</span>
            <span className="font-medium tabular-nums">{model.successRate.toFixed(0)}%</span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-2 rounded-full transition-[width] duration-300", {
                "bg-green-500": model.successRate >= 95,
                "bg-yellow-500": model.successRate < 95 && model.successRate >= 80,
                "bg-red-500": model.successRate < 80,
              })}
              style={{ width: `${Math.max(0, Math.min(100, model.successRate))}%` }}
            />
          </div>
        </div>

        <div className="border-t pt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>HISTORY (60PTS)</span>
            <span>{new Date(model.lastCheck).toLocaleString("zh-CN")}</span>
          </div>
          {blocks.length > 0 ? (
            <div className="mt-2 grid grid-cols-[repeat(60,minmax(0,1fr))] gap-[2px]">
              {blocks.map((block, i) => (
                <div
                  key={i}
                  className={cn("h-5 rounded-[2px]", {
                    "bg-green-500": block.success,
                    "bg-red-500": !block.success,
                  })}
                  title={`${new Date(block.timestamp).toLocaleString("zh-CN")} · ${block.success ? "成功" : "失败"}`}
                />
              ))}
            </div>
          ) : (
            <div className="mt-2 text-center text-sm text-muted-foreground py-2">暂无历史数据</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// 提供商卡片（可折叠）
const ProviderCard = ({ provider, consoleLatency }: { provider: ProviderHealth; consoleLatency: ConsoleLatencyState }) => {
  const [expanded, setExpanded] = useState(false); // 默认收起
  // 后端返回的 errorRate 是百分比（0-100），这里做一次容错处理并转换为成功率百分比。
  const successRate = (() => {
    const raw = typeof provider.errorRate === "number" ? provider.errorRate : 0;
    const errorRatePercent = raw <= 1 ? raw * 100 : raw;
    const ok = Math.max(0, Math.min(100, 100 - errorRatePercent));
    return ok.toFixed(1);
  })();

  const consoleLatencyText = useMemo(() => {
    switch (consoleLatency.status) {
      case "na":
        return "控制台延迟: -";
      case "loading":
        return "控制台延迟: 检测中…";
      case "ok":
        return `控制台延迟: ${formatResponseTime(consoleLatency.ms)}`;
      case "error":
        return "控制台延迟: 失败";
      default:
        return "控制台延迟: -";
    }
  }, [consoleLatency]);

  const consoleLatencyTitle = consoleLatency.status === "error" ? consoleLatency.message : undefined;

  return (
    <Card className={providerCardHoverClass}>
      <CardHeader>
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="size-5 text-muted-foreground transition-transform" />
            ) : (
              <ChevronRight className="size-5 text-muted-foreground transition-transform" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{provider.name}</CardTitle>
                <StatusBadge status={provider.status} />
              </div>
              <CardDescription className="mt-1">
                {provider.type} · {provider.models.length} 个模型 · 成功率 {successRate}% · {provider.totalRequests.toLocaleString()} 次请求
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>平均响应: {formatResponseTime(provider.responseTimeMs)}</span>
            <span>·</span>
            <span title={consoleLatencyTitle}>
              {consoleLatencyText}
            </span>
          </div>
        </div>
      </CardHeader>

      {expanded && provider.models.length > 0 && (
        <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {provider.models.map((model) => (
            <ModelHealthCard
              key={`${provider.id}-${model.modelName}`}
              provider={provider}
              model={model}
              consoleLatency={consoleLatency}
            />
          ))}
        </CardContent>
      )}

      {expanded && provider.models.length === 0 && (
        <CardContent>
          <div className="py-8 text-center text-muted-foreground text-sm">
            该提供商下暂无模型数据
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default function HealthPage() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [timeWindow, setTimeWindow] = useState<number>(1440); // 默认 24 小时
  const [providerConsoleMap, setProviderConsoleMap] = useState<Record<number, string>>({});
  const [consoleLatencyMap, setConsoleLatencyMap] = useState<Record<number, ConsoleLatencyState>>({});
  const consoleLatencyRef = useRef<Record<number, ConsoleLatencyState>>({});
  const inFlightControllersRef = useRef<AbortController[]>([]);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await getSystemHealthDetail(timeWindow);
      setHealth(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取健康状态失败: ${message}`);
      console.error(err);
    }
  }, [timeWindow]);

  const load = useCallback(async () => {
    setLoading(true);
    await fetchHealth();
    setLoading(false);
  }, [fetchHealth]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    consoleLatencyRef.current = consoleLatencyMap;
  }, [consoleLatencyMap]);

  const loadProvidersForConsole = useCallback(async () => {
    try {
      const list = await getProviders();
      const map: Record<number, string> = {};
      for (const p of list as Provider[]) {
        if (p && typeof p.ID === "number" && typeof p.Console === "string") {
          map[p.ID] = p.Console;
        }
      }
      setProviderConsoleMap(map);
    } catch (err) {
      console.error(err);
      setProviderConsoleMap({});
    }
  }, []);

  const cancelConsoleProbes = useCallback(() => {
    for (const c of inFlightControllersRef.current) {
      try {
        c.abort();
      } catch {
        // ignore
      }
    }
    inFlightControllersRef.current = [];
  }, []);

  const checkConsoleLatencies = useCallback(async (providerList: ProviderHealth[]) => {
    cancelConsoleProbes();

    const minIntervalMs = 30_000;
    const now = Date.now();

    const pickPingUrl = (providerId: number) => withNoCachePing(providerConsoleMap[providerId] || "");

    const shouldProbe = (providerId: number, prev: ConsoleLatencyState | undefined) => {
      if (!pickPingUrl(providerId)) return false;
      if (!prev) return true;
      if (prev.status === "loading" || prev.status === "na") return true;
      if (prev.status === "ok" || prev.status === "error") {
        return now - prev.checkedAt >= minIntervalMs;
      }
      return true;
    };

    // 初始化状态（只把需要探测的置为 loading，避免每次刷新都频繁打控制台）
    setConsoleLatencyMap((prev) => {
      const next: Record<number, ConsoleLatencyState> = { ...prev };
      for (const p of providerList) {
        const pingUrl = pickPingUrl(p.id);
        if (!pingUrl) {
          next[p.id] = { status: "na" };
          continue;
        }
        if (shouldProbe(p.id, prev[p.id])) {
          next[p.id] = { status: "loading" };
        }
      }
      return next;
    });

    const concurrency = 3;
    let idx = 0;
    const currentMap = consoleLatencyRef.current;
    const targets = providerList.filter((p) => shouldProbe(p.id, currentMap[p.id]));
    const tasks = targets.map((p) => async () => {
      const pingUrl = pickPingUrl(p.id);
      if (!pingUrl) return;

      const controller = new AbortController();
      inFlightControllersRef.current.push(controller);
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const ms = await probeConsoleLatencyMs(pingUrl, controller.signal);
        const checkedAt = Date.now();
        setConsoleLatencyMap((prev) => ({ ...prev, [p.id]: { status: "ok", ms, checkedAt } }));
      } catch (err) {
        const checkedAt = Date.now();
        const message = err instanceof Error ? err.message : String(err);
        setConsoleLatencyMap((prev) => ({ ...prev, [p.id]: { status: "error", message, checkedAt } }));
      } finally {
        clearTimeout(timeout);
      }
    });

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (idx < tasks.length) {
        const current = idx++;
        await tasks[current]();
      }
    });
    await Promise.all(workers);
  }, [cancelConsoleProbes, providerConsoleMap]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      void fetchHealth();
    }, 30000); // 每 30 秒刷新一次

    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  // 加载提供商列表（用于拿到 console URL）
  useEffect(() => {
    void loadProvidersForConsole();
  }, [loadProvidersForConsole]);

  // 当健康数据与 console 映射都准备好后，进行一次控制台延迟探测
  useEffect(() => {
    if (!health) return;
    if (Object.keys(providerConsoleMap).length === 0) return;
    void checkConsoleLatencies(health.components.providers.details);
  }, [health, providerConsoleMap, checkConsoleLatencies]);

  if (loading || !health) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading message="加载健康状态" />
      </div>
    );
  }

  const { components } = health;
  const { database, redis, providers } = components;

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 p-1">
      {/* 页面头部 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="size-6" />
            模型状态监控
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            最近100次请求 · {providers.total} 个提供商 · {providers.details.reduce((sum, p) => sum + p.models.length, 0)} 个模型
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <Select value={timeWindow.toString()} onValueChange={(v) => setTimeWindow(Number(v))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60">最近 1 小时</SelectItem>
                <SelectItem value="360">最近 6 小时</SelectItem>
                <SelectItem value="1440">最近 24 小时</SelectItem>
                <SelectItem value="4320">最近 3 天</SelectItem>
                <SelectItem value="10080">最近 7 天</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
          >
            {autoRefresh ? "自动刷新已开启" : "开启自动刷新"}
          </Button>
          <Button
            onClick={() => void load()}
            variant="outline"
            size="icon"
            title="刷新"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {/* 系统整体状态 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>系统整体状态</CardTitle>
              <StatusBadge status={health.status} />
            </div>
            <CardDescription>
              最后更新: {new Date(health.timestamp).toLocaleString('zh-CN')} · 系统运行: {formatUptime(calcUptimeFromFirstDeployTime(health))} · 本次启动: {formatUptime(health.processUptime)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">{providers.total}</div>
                <div className="text-sm text-muted-foreground">提供商</div>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{providers.healthy}</div>
                <div className="text-sm text-muted-foreground">正常</div>
              </div>
              <div className="text-center p-3 bg-yellow-500/10 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">{providers.degraded}</div>
                <div className="text-sm text-muted-foreground">警告</div>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{providers.unhealthy}</div>
                <div className="text-sm text-muted-foreground">异常</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 基础组件状态 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 数据库状态 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="size-4" />
                  数据库
                </CardTitle>
                <StatusBadge status={database.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {database.responseTimeMs !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">响应时间</span>
                  <span className="font-semibold">{formatResponseTime(database.responseTimeMs)}</span>
                </div>
              )}
              {database.message && (
                <div className="text-sm text-muted-foreground">{database.message}</div>
              )}
            </CardContent>
          </Card>

          {/* Redis 状态 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="size-4" />
                  Redis 缓存
                </CardTitle>
                <StatusBadge status={redis.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {redis.responseTimeMs !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">响应时间</span>
                  <span className="font-semibold">{formatResponseTime(redis.responseTimeMs)}</span>
                </div>
              )}
              {redis.message && (
                <div className="text-sm text-muted-foreground">
                  {redis.message === "disabled" ? "未启用" : redis.message}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Provider 状态详情（层级展示） */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Server className="size-5" />
            <h3 className="text-lg font-semibold">提供商与模型详情</h3>
          </div>

          {providers.details.length > 0 ? (
            <div className="space-y-3">
              {providers.details.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  consoleLatency={consoleLatencyMap[provider.id] ?? { status: "na" }}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                暂无提供商数据
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
