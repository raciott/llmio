import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import Loading from "@/components/loading";
import { getSystemHealthDetail, type SystemHealth, type ProviderHealth, type ModelHealth } from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertCircle, XCircle, Activity, Database, HardDrive, Server, Clock, ChevronDown, ChevronRight } from "lucide-react";

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

// 模型健康状态卡片（带请求块）
const ModelHealthCard = ({ model }: { model: ModelHealth }) => {
  return (
    <div className="p-4 bg-muted/30 rounded-lg space-y-3">
      {/* 模型信息和统计 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{model.modelName}</span>
          <StatusBadge status={model.status} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-green-600 font-semibold">{model.successRate.toFixed(1)}%</span>
            <span className="text-muted-foreground ml-1">成功率</span>
          </div>
          <div>
            <span className="font-semibold">{model.totalRequests.toLocaleString()}</span>
            <span className="text-muted-foreground ml-1">请求</span>
          </div>
        </div>
      </div>

      {/* 最近100次请求块 */}
      <div className="space-y-2">
        {model.requestBlocks.length > 0 ? (
          <>
            <div className="grid grid-cols-[repeat(100,minmax(0,1fr))] gap-[1px]">
              {model.requestBlocks.map((block, i) => {
                const blockClass = cn("h-7 rounded-[1px] transition-all hover:opacity-80 cursor-pointer", {
                  "bg-green-500": block.success,
                  "bg-red-500": !block.success,
                });

                return (
                  <div
                    key={i}
                    className={blockClass}
                    title={`第 ${i + 1} 次\n${new Date(block.timestamp).toLocaleString('zh-CN')}\n状态: ${block.success ? '成功' : '失败'}`}
                  />
                );
              })}
            </div>

            {/* 标签说明 */}
            <div className="flex justify-between items-center text-xs text-muted-foreground px-1">
              <span>最近 {model.requestBlocks.length} 次请求</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-green-500 rounded-sm"></div>
                  <span>成功</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-red-500 rounded-sm"></div>
                  <span>失败</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-4 text-sm text-muted-foreground">
            暂无请求数据
          </div>
        )}
      </div>

      {/* 最近错误（如果有） */}
      {model.lastError && (
        <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive break-words">
          <div className="font-semibold">最近错误：</div>
          <div className="mt-1">{model.lastError}</div>
        </div>
      )}
    </div>
  );
};

// 提供商卡片（可折叠）
const ProviderCard = ({ provider }: { provider: ProviderHealth }) => {
  const [expanded, setExpanded] = useState(false); // 默认收起
  const successRate = ((1 - provider.errorRate) * 100).toFixed(1);

  return (
    <Card>
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
          </div>
        </div>
      </CardHeader>

      {expanded && provider.models.length > 0 && (
        <CardContent className="space-y-3">
          {provider.models.map((model) => (
            <ModelHealthCard key={`${provider.id}-${model.modelName}`} model={model} />
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

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      void fetchHealth();
    }, 30000); // 每 30 秒刷新一次

    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

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
                <ProviderCard key={provider.id} provider={provider} />
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
