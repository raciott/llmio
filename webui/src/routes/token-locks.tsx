import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Lock } from "lucide-react";

import Loading from "@/components/loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { getTokenLocks, type TokenLock } from "@/lib/api";

function formatRemainSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "已过期";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function TokenLocksPage() {
  const [loading, setLoading] = useState(true);
  const [locks, setLocks] = useState<TokenLock[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [keyword, setKeyword] = useState("");

  const fetchLocks = useCallback(async () => {
    try {
      const data = await getTokenLocks();
      setLocks(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取 Token 锁定失败: ${message}`);
      console.error(err);
      setLocks([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await fetchLocks();
    setLoading(false);
  }, [fetchLocks]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      void fetchLocks();
    }, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchLocks]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return locks;
    return locks.filter((l) => {
      const hay = [
        l.modelName,
        l.providerName,
        l.providerModel,
        String(l.tokenId),
        String(l.modelWithProviderId),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [locks, keyword]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading message="加载 Token 锁定" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 p-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Lock className="size-6" />
            Token 锁定
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            该页面从 Redis 读取最近 2 分钟内的 token→模型提供商独占锁，用于排查“同 token 独占供应商”行为。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            onClick={() => setAutoRefresh(v => !v)}
            title="开启后每 5 秒自动刷新一次"
          >
            {autoRefresh ? "自动刷新已开启" : "开启自动刷新"}
          </Button>
          <Button variant="secondary" onClick={() => void fetchLocks()} title="立即刷新">
            <RefreshCw className="size-4 mr-2" />
            刷新
          </Button>
        </div>
      </div>

      <Card className="flex-1 min-h-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span>当前锁定</span>
            <span className="text-xs text-muted-foreground">共 {filtered.length} 条</span>
          </CardTitle>
          <CardContent className="px-0 pt-3 pb-0">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索模型/提供商/TokenID/关联ID"
              />
            </div>
          </CardContent>
        </CardHeader>

        <CardContent className="h-full min-h-0 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              当前没有有效的 Token 锁定（或 Redis 未命中）
            </div>
          ) : (
            <div className="w-full">
              <Table className="min-w-[900px]">
                <TableHeader className="z-10 sticky top-0 bg-secondary/80 text-secondary-foreground">
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableHead>提供商</TableHead>
                    <TableHead>提供商模型</TableHead>
                    <TableHead>TokenID</TableHead>
                    <TableHead>剩余时间</TableHead>
                    <TableHead>到期时间</TableHead>
                    <TableHead>关联ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((l) => (
                    <TableRow key={`${l.modelWithProviderId}-${l.tokenId}`}>
                      <TableCell className="font-medium">{l.modelName || "-"}</TableCell>
                      <TableCell>{l.providerName || "-"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{l.providerModel || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.tokenId}</TableCell>
                      <TableCell className="font-mono text-xs">{formatRemainSeconds(l.ttlSeconds)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.lockedUntil ? new Date(l.lockedUntil).toLocaleString("zh-CN") : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{l.modelWithProviderId}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

