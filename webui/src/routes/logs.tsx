import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Loading from "@/components/loading";
import { getLogs, getProviders, getModelOptions, getAuthKeysList, type ChatLog, type Provider, type Model, type AuthKeyItem, getProviderTemplates, cleanLogs } from "@/lib/api";
import { ChevronLeft, ChevronRight, RefreshCw, Trash2, Eye, EyeOff, Timer, ArrowDown, ArrowUp, Zap, Coins } from "lucide-react";
import hunyuanIcon from "@/assets/modelIcon/hunyuan.svg";
import doubaoIcon from "@/assets/modelIcon/doubao.svg";
import grokIcon from "@/assets/modelIcon/grok.svg";
import qwenIcon from "@/assets/modelIcon/qwen.svg";
import minimaxIcon from "@/assets/modelIcon/minimax.svg";
import openaiIcon from "@/assets/modelIcon/openai.svg";
import claudeIcon from "@/assets/modelIcon/claude.svg";
import geminiIcon from "@/assets/modelIcon/gemini.svg";
import deepseekIcon from "@/assets/modelIcon/deepseek.svg";

// 格式化耗时显示（后端字段单位为毫秒）
const formatDurationMs = (milliseconds: number): string => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "-";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(2)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

// 兼容不同字段命名（例如旧版前端/后端字段不一致时），统一得到毫秒数。
const getLogDurationsMs = (log: ChatLog) => {
  const raw = log as unknown as Record<string, unknown>;
  const proxy = toFiniteNumber(raw.ProxyTimeMs) ?? toFiniteNumber(raw.proxy_time_ms) ?? toFiniteNumber(raw.ProxyTime) ?? 0;
  const first = toFiniteNumber(raw.FirstChunkTimeMs) ?? toFiniteNumber(raw.first_chunk_time_ms) ?? toFiniteNumber(raw.FirstChunkTime) ?? 0;
  const chunk = toFiniteNumber(raw.ChunkTimeMs) ?? toFiniteNumber(raw.chunk_time_ms) ?? toFiniteNumber(raw.ChunkTime) ?? 0;
  return { proxy, first, chunk, total: proxy + first + chunk };
};

// 格式化字节大小显示
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

type DetailCardProps = {
  label: string;
  value: ReactNode;
  mono?: boolean;
};

const DetailCard = ({ label, value, mono = false }: DetailCardProps) => (
  <div className="rounded-md border bg-muted/20 p-3 space-y-1">
    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
    <div className={`text-sm break-words ${mono ? 'font-mono text-xs' : ''}`}>
      {value ?? '-'}
    </div>
  </div>
);

const formatDurationValue = (value?: number) => (typeof value === "number" ? formatDurationMs(value) : "-");
const formatTokenValue = (value?: number) => (typeof value === "number" ? value.toLocaleString() : "-");
const formatTpsValue = (value?: number) => (typeof value === "number" ? value.toFixed(2) : "-");
const formatCostValue = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const trimmed = value.toFixed(6).replace(/\.?0+$/, "");
  return `$${trimmed}`;
};

const parsePromptTokensDetails = (value: ChatLog["prompt_tokens_details"]) => {
  if (!value) return { cached_tokens: 0 };
  if (typeof value === "object") return value as { cached_tokens: number };
  if (typeof value !== "string") return { cached_tokens: 0 };
  const trimmed = value.trim();
  if (!trimmed) return { cached_tokens: 0 };
  try {
    const parsed = JSON.parse(trimmed) as { cached_tokens?: number };
    return { cached_tokens: typeof parsed?.cached_tokens === "number" ? parsed.cached_tokens : 0 };
  } catch {
    return { cached_tokens: 0 };
  }
};

type ModelIconConfig = {
  test: RegExp;
  src: string;
  alt: string;
};

const modelIconConfigs: ModelIconConfig[] = [
  { test: /hunyuan/i, src: hunyuanIcon, alt: "Hunyuan" },
  { test: /doubao|ark/i, src: doubaoIcon, alt: "Doubao" },
  { test: /grok|xai/i, src: grokIcon, alt: "Grok" },
  { test: /qwen|tongyi/i, src: qwenIcon, alt: "Qwen" },
  { test: /minimax|abab/i, src: minimaxIcon, alt: "MiniMax" },
  { test: /openai|gpt|o1|o3|o4/i, src: openaiIcon, alt: "OpenAI" },
  { test: /claude|anthropic/i, src: claudeIcon, alt: "Claude" },
  { test: /gemini|google/i, src: geminiIcon, alt: "Gemini" },
  { test: /deepseek/i, src: deepseekIcon, alt: "DeepSeek" },
];

const ModelIcon = ({ name }: { name: string }) => {
  const config = modelIconConfigs.find((item) => item.test.test(name));
  const fallback = (name || "M").slice(0, 2).toUpperCase();

  if (!config) {
    return (
      <div className="size-10 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center font-semibold text-xs">
        {fallback}
      </div>
    );
  }

  return (
    <div className="size-10 rounded-2xl bg-muted/60 flex items-center justify-center">
      <img src={config.src} alt={config.alt} className="size-5" />
    </div>
  );
};

export default function LogsPage() {
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [authKeys, setAuthKeys] = useState<AuthKeyItem[]>([]);
  // 筛选条件
  const [providerNameFilter, setProviderNameFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [styleFilter, setStyleFilter] = useState<string>("all");
  const [authKeyFilter, setAuthKeyFilter] = useState<string>("all");
  const [availableStyles, setAvailableStyles] = useState<string[]>([]);
  const navigate = useNavigate();
  // 详情弹窗
  const [selectedLog, setSelectedLog] = useState<ChatLog | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // 清理弹窗
  const [cleanType, setCleanType] = useState<'count' | 'days'>('count');
  const [cleanValue, setCleanValue] = useState<string>('1000');
  const [isCleanDialogOpen, setIsCleanDialogOpen] = useState(false);
  const [cleanLoading, setCleanLoading] = useState(false);
  // 获取数据
  const fetchProviders = async () => {
    try {
      const providerList = await getProviders();
      setProviders(providerList);
      const templates = await getProviderTemplates();
      const styleTypes = templates.map(template => template.type);
      setAvailableStyles(styleTypes);
    } catch (error) {
      console.error("Error fetching providers:", error);
    }
  };
  const fetchModels = async () => {
    try {
      const modelList = await getModelOptions();
      setModels(modelList);
    } catch (error) {
      console.error("Error fetching models:", error);
    }
  };
  const fetchAuthKeys = async () => {
    try {
      const authKeyList = await getAuthKeysList();
      setAuthKeys(authKeyList);
    } catch (error) {
      console.error("Error fetching auth keys:", error);
    }
  };
  const fetchLogs = async () => {
    setLoading(true);
    try {
      const result = await getLogs(page, pageSize, {
        providerName: providerNameFilter === "all" ? undefined : providerNameFilter,
        name: modelFilter === "all" ? undefined : modelFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        style: styleFilter === "all" ? undefined : styleFilter,
        authKeyId: authKeyFilter === "all" ? undefined : authKeyFilter
      });
      setLogs(result.data);
      setTotal(result.total);
      setPages(result.pages);
    } catch (error) {
      console.error("Error fetching logs:", error);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchProviders();
    fetchModels();
    fetchAuthKeys();
    fetchLogs();
  }, [page, pageSize, providerNameFilter, modelFilter, statusFilter, styleFilter, authKeyFilter]);
  const handleFilterChange = () => {
    setPage(1);
  };
  useEffect(() => {
    handleFilterChange();
  }, [providerNameFilter, modelFilter, statusFilter, styleFilter, authKeyFilter]);
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pages) setPage(newPage);
  };
  const handlePageSizeChange = (size: number) => {
    if (size === pageSize) return;
    setPage(1);
    setPageSize(size);
  };
  const handleRefresh = () => {
    fetchLogs();
  };
  const handleCleanTypeChange = (type: 'count' | 'days') => {
    setCleanType(type);
    setCleanValue(type === 'count' ? '1000' : '30');
  };
  const handleCleanLogs = async () => {
    const value = parseInt(cleanValue);
    if (isNaN(value) || value <= 0) return;

    setCleanLoading(true);
    try {
      const result = await cleanLogs({ type: cleanType, value });
      toast.success(`已清理 ${result.deleted_count} 条日志`);
      fetchLogs();
    } catch (error) {
      console.error("Error cleaning logs:", error);
      toast.error('清理失败');
    } finally {
      setCleanLoading(false);
      setIsCleanDialogOpen(false);
    }
  };
  const openDetailDialog = (log: ChatLog) => {
    setSelectedLog(log);
    setIsDialogOpen(true);
  };
  const canViewChatIO = (log: ChatLog) => log.Status === 'success' && log.ChatIO;
  const handleViewChatIO = (log: ChatLog) => {
    if (!canViewChatIO(log)) return;
    navigate(`/logs/${log.ID}/chat-io`);
  };
  // 布局开始
  return (
    <div className="h-full min-h-0 flex flex-col gap-2 p-1">
      {/* 顶部标题和刷新 */}
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">请求日志</h2>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setIsCleanDialogOpen(true)}
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="清理日志"
              title="清理日志"
            >
              <Trash2 className="size-4" />
            </Button>
            <Button
              onClick={handleRefresh}
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="刷新列表"
              title="刷新列表"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      {/* 筛选区域 */}
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
          <div className="flex flex-col gap-1 text-xs lg:min-w-0">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">模型名称</Label>
            <Select value={modelFilter} onValueChange={setModelFilter}>
              <SelectTrigger className="h-8 text-xs w-full px-2">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {models.map((model) => (
                  <SelectItem key={model.ID} value={model.Name}>{model.Name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-xs lg:min-w-0">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">项目</Label>
            <Select value={authKeyFilter} onValueChange={setAuthKeyFilter}>
              <SelectTrigger className="h-8 text-xs w-full px-2">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {authKeys.map((key) => (
                  <SelectItem key={key.id} value={key.id.toString()}>{key.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-xs lg:min-w-0">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">状态</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs w-full px-2">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="error">错误</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-xs lg:min-w-0">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">类型</Label>
            <Select value={styleFilter} onValueChange={setStyleFilter}>
              <SelectTrigger className="h-8 text-xs w-full px-2">
                <SelectValue placeholder="类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {availableStyles.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex flex-col gap-1 text-xs lg:min-w-0 sm:col-span-1">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">提供商</Label>
            <Select value={providerNameFilter} onValueChange={setProviderNameFilter}>
              <SelectTrigger className="h-8 text-xs w-full px-2">
                <SelectValue placeholder="选择提供商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.ID} value={p.Name}>{p.Name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      {/* 列表区域 */}
      <div className="flex-1 min-h-0 border rounded-md bg-background shadow-sm">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loading message="加载日志数据" />
          </div>
        ) : logs?.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            暂无请求日志
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-3">
                {logs?.map((log) => {
                  const durations = getLogDurationsMs(log);
                  const statusText = log.Status === "success" ? "成功" : "错误";
                  const statusClass = log.Status === "success"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-rose-100 text-rose-700";
                  const createdAt = new Date(log.CreatedAt).toLocaleString();
                  return (
                    <div key={log.ID} className="rounded-2xl border border-border/60 bg-card/90 shadow-sm px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <ModelIcon name={log.Name || ""} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="font-semibold truncate max-w-[26ch]" title={log.Name}>
                                {log.Name}
                              </span>
                              <span className="text-xs text-muted-foreground">-&gt;</span>
                            <span className="inline-flex items-center rounded-full bg-muted/70 px-2 py-0.5 text-xs text-muted-foreground">
                              {log.ProviderName || "-"}
                            </span>
                            <span className="text-xs text-muted-foreground truncate max-w-[26ch]" title={log.ProviderModel || "-"}>
                              {log.ProviderModel || "-"}
                            </span>
                            <span className="text-[11px] text-muted-foreground">{createdAt}</span>
                            {log.Style ? (
                              <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                                {log.Style}
                              </span>
                            ) : null}
                            {log.key_name ? (
                              <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                                {log.key_name}
                              </span>
                            ) : null}
                            <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${statusClass}`}>
                              {statusText}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-5">
                            <div className="flex items-center gap-1.5">
                              <Zap className="size-3 text-amber-500" />
                              <span className="text-muted-foreground">首字</span>
                              <span className="tabular-nums text-foreground">
                                {formatDurationMs(durations.first)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Timer className="size-3 text-blue-500" />
                              <span className="text-muted-foreground">总耗时</span>
                              <span className="tabular-nums text-foreground">
                                {formatDurationMs(durations.total)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <ArrowDown className="size-3 text-emerald-500" />
                              <span className="text-muted-foreground">输入</span>
                              <span className="tabular-nums text-foreground">
                                {formatTokenValue(log.prompt_tokens)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <ArrowUp className="size-3 text-violet-500" />
                              <span className="text-muted-foreground">输出</span>
                              <span className="tabular-nums text-foreground">
                                {formatTokenValue(log.completion_tokens)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Coins className="size-3 text-emerald-600" />
                              <span className="text-muted-foreground">价格</span>
                              <span className="tabular-nums text-foreground">
                                {formatCostValue(log.total_cost)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openDetailDialog(log)}
                            aria-label="查看详情"
                            title="查看详情"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleViewChatIO(log)}
                            disabled={!canViewChatIO(log)}
                            aria-label="查看 IO"
                            title="查看 IO"
                          >
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* 分页区域 */}

      <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0 border-t pt-2">
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          共 {total} 条，第 {page} / {pages} 页
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Select value={String(pageSize)} onValueChange={(value) => handlePageSizeChange(Number(value))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="条数" />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
              aria-label="上一页"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handlePageChange(page + 1)}
              disabled={page === pages}
              aria-label="下一页"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      {/* 详情弹窗 */}
      {selectedLog && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="w-[92vw] sm:w-auto sm:max-w-2xl max-h-[95vh] p-0 flex flex-col">
            <div className="px-5 py-4 border-b">
              <DialogHeader className="p-0">
                <DialogTitle className="flex items-center gap-2">
                  日志详情
                  <span className="text-xs text-muted-foreground font-normal">#{selectedLog.ID}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{new Date(selectedLog.CreatedAt).toLocaleString()}</span>
                <span className={selectedLog.Status === "success" ? "text-emerald-600" : "text-rose-600"}>
                  {selectedLog.Status}
                </span>
                {selectedLog.Style ? (
                  <span className="rounded-full bg-muted/60 px-2 py-0.5">{selectedLog.Style}</span>
                ) : null}
                {selectedLog.key_name ? (
                  <span className="rounded-full bg-muted/60 px-2 py-0.5">{selectedLog.key_name}</span>
                ) : null}
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4 text-sm">
              {selectedLog.Error && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
                  <p className="text-xs text-destructive uppercase tracking-wide mb-1">错误信息</p>
                  <div className="text-destructive whitespace-pre-wrap break-words text-sm">
                    {selectedLog.Error}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DetailCard label="模型名称" value={selectedLog.Name} />
                <DetailCard label="提供商" value={selectedLog.ProviderName || "-"} />
                <DetailCard label="提供商模型" value={selectedLog.ProviderModel || "-"} mono />
                <DetailCard label="响应大小" value={selectedLog.Size ? formatBytes(selectedLog.Size) : "-"} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(() => {
                  const d = getLogDurationsMs(selectedLog);
                  return (
                    <>
                      <DetailCard label="代理耗时" value={formatDurationValue(d.proxy)} />
                      <DetailCard label="首包耗时" value={formatDurationValue(d.first)} />
                      <DetailCard label="完成耗时" value={formatDurationValue(d.chunk)} />
                      <DetailCard label="TPS" value={formatTpsValue(selectedLog.Tps)} />
                    </>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(() => {
                  const details = parsePromptTokensDetails(selectedLog.prompt_tokens_details);
                  return (
                    <>
                      <DetailCard label="输入" value={formatTokenValue(selectedLog.prompt_tokens)} />
                      <DetailCard label="输出" value={formatTokenValue(selectedLog.completion_tokens)} />
                      <DetailCard label="总计" value={formatTokenValue(selectedLog.total_tokens)} />
                      <DetailCard label="缓存" value={formatTokenValue(details.cached_tokens)} />
                      <DetailCard label="价格" value={formatCostValue(selectedLog.total_cost)} />
                    </>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DetailCard label="远端 IP" value={selectedLog.RemoteIP || "-"} mono />
                <DetailCard label="用户代理" value={selectedLog.UserAgent || "-"} mono />
                <DetailCard label="记录 IO" value={selectedLog.ChatIO ? "是" : "否"} />
                <DetailCard label="重试次数" value={selectedLog.Retry ?? 0} />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {/* 清理日志弹窗 */}
      <Dialog open={isCleanDialogOpen} onOpenChange={setIsCleanDialogOpen}>
        <DialogContent className="w-[92vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>清理日志</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Button
                variant={cleanType === 'count' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleCleanTypeChange('count')}
                className="flex-1"
              >
                保留条数
              </Button>
              <Button
                variant={cleanType === 'days' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleCleanTypeChange('days')}
                className="flex-1"
              >
                保留天数
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="1"
                value={cleanValue}
                onChange={(e) => setCleanValue(e.target.value)}
                placeholder={cleanType === 'count' ? '输入保留条数' : '输入保留天数'}
                className="h-10"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {cleanType === 'count' ? '条' : '天'}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsCleanDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleCleanLogs}
              disabled={cleanLoading || !cleanValue || parseInt(cleanValue) <= 0}
            >
              {cleanLoading ? '清理中...' : '确定清理'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
