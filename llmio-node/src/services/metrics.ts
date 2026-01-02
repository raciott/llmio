/**
 * Prometheus 风格的指标收集服务
 */

// 指标存储
interface MetricValue {
  value: number;
  labels: Record<string, string>;
}

class MetricsCollector {
  private counters = new Map<string, MetricValue[]>();
  private gauges = new Map<string, MetricValue[]>();
  private histograms = new Map<string, { buckets: number[]; values: number[]; labels: Record<string, string> }[]>();

  // 计数器：累加值（如请求总数）
  incrementCounter(name: string, labels: Record<string, string> = {}, value = 1) {
    if (!this.counters.has(name)) {
      this.counters.set(name, []);
    }
    const metrics = this.counters.get(name)!;
    const existing = metrics.find((m) => this.labelsEqual(m.labels, labels));
    if (existing) {
      existing.value += value;
    } else {
      metrics.push({ value, labels });
    }
  }

  // 仪表盘：当前值（如活跃连接数）
  setGauge(name: string, value: number, labels: Record<string, string> = {}) {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, []);
    }
    const metrics = this.gauges.get(name)!;
    const existing = metrics.find((m) => this.labelsEqual(m.labels, labels));
    if (existing) {
      existing.value = value;
    } else {
      metrics.push({ value, labels });
    }
  }

  // 直方图：观察值分布（如响应时间）
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    const metrics = this.histograms.get(name)!;
    let existing = metrics.find((m) => this.labelsEqual(m.labels, labels));
    if (!existing) {
      // 默认桶：50ms, 100ms, 200ms, 500ms, 1s, 2s, 5s, 10s, +Inf
      existing = {
        buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000, Infinity],
        values: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        labels,
      };
      metrics.push(existing);
    }
    // 将值分配到相应的桶
    for (let i = 0; i < existing.buckets.length; i++) {
      if (value <= existing.buckets[i]!) {
        existing.values[i]!++;
      }
    }
  }

  private labelsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i] || a[keysA[i]!] !== b[keysB[i]!]) return false;
    }
    return true;
  }

  // 导出 Prometheus 格式
  export(): string {
    const lines: string[] = [];

    // 导出计数器
    for (const [name, metrics] of this.counters.entries()) {
      lines.push(`# HELP ${name} Total count`);
      lines.push(`# TYPE ${name} counter`);
      for (const m of metrics) {
        const labels = this.formatLabels(m.labels);
        lines.push(`${name}${labels} ${m.value}`);
      }
    }

    // 导出仪表盘
    for (const [name, metrics] of this.gauges.entries()) {
      lines.push(`# HELP ${name} Current value`);
      lines.push(`# TYPE ${name} gauge`);
      for (const m of metrics) {
        const labels = this.formatLabels(m.labels);
        lines.push(`${name}${labels} ${m.value}`);
      }
    }

    // 导出直方图
    for (const [name, metrics] of this.histograms.entries()) {
      lines.push(`# HELP ${name} Response time histogram`);
      lines.push(`# TYPE ${name} histogram`);
      for (const m of metrics) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < m.buckets.length; i++) {
          const bucket = m.buckets[i]!;
          const value = m.values[i]!;
          count += value;
          if (bucket !== Infinity) {
            sum += value * bucket;
          }
          const bucketLabel = bucket === Infinity ? "+Inf" : bucket.toString();
          const labels = this.formatLabels({ ...m.labels, le: bucketLabel });
          lines.push(`${name}_bucket${labels} ${count}`);
        }
        const labels = this.formatLabels(m.labels);
        lines.push(`${name}_sum${labels} ${sum}`);
        lines.push(`${name}_count${labels} ${count}`);
      }
    }

    return lines.join("\n") + "\n";
  }

  private formatLabels(labels: Record<string, string>): string {
    const keys = Object.keys(labels);
    if (keys.length === 0) return "";
    const pairs = keys.map((k) => `${k}="${labels[k]}"`);
    return `{${pairs.join(",")}}`;
  }

  // 重置所有指标（用于测试）
  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// 全局单例
export const metrics = new MetricsCollector();

// 便捷方法
export function recordRequest(method: string, path: string, status: number, durationMs: number) {
  metrics.incrementCounter("http_requests_total", { method, path, status: status.toString() });
  metrics.observeHistogram("http_request_duration_ms", durationMs, { method, path });
}

export function recordProviderRequest(
  provider: string,
  model: string,
  success: boolean,
  durationMs: number,
  tokens?: number
) {
  const status = success ? "success" : "error";
  metrics.incrementCounter("provider_requests_total", { provider, model, status });
  metrics.observeHistogram("provider_request_duration_ms", durationMs, { provider, model, status });
  if (tokens !== undefined) {
    metrics.incrementCounter("provider_tokens_total", { provider, model }, tokens);
  }
}

// 记录 HTTP 请求指标
export function recordHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number
) {
  metrics.incrementCounter("http_requests_total", {
    method,
    path,
    status: status.toString(),
  });
  metrics.observeHistogram("http_request_duration_ms", durationMs, {
    method,
    path,
  });
}

// 记录错误
export function recordError(errorType: string, provider?: string, model?: string) {
  const labels: Record<string, string> = { error_type: errorType };
  if (provider) labels.provider = provider;
  if (model) labels.model = model;
  metrics.incrementCounter("errors_total", labels);
}

// 记录重试次数
export function recordRetry(provider: string, model: string, retryCount: number) {
  metrics.incrementCounter("provider_retries_total", { provider, model }, retryCount);
}

// 记录流式响应的首字节时间
export function recordFirstChunkTime(provider: string, model: string, timeMs: number) {
  metrics.observeHistogram("provider_first_chunk_time_ms", timeMs, { provider, model });
}

// 记录 token 使用情况
export function recordTokenUsage(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number
) {
  metrics.incrementCounter("provider_prompt_tokens_total", { provider, model }, promptTokens);
  metrics.incrementCounter("provider_completion_tokens_total", { provider, model }, completionTokens);
}

export function setActiveConnections(count: number) {
  metrics.setGauge("active_connections", count);
}

export function setDatabasePoolSize(total: number, idle: number, waiting: number) {
  metrics.setGauge("database_pool_total", total);
  metrics.setGauge("database_pool_idle", idle);
  metrics.setGauge("database_pool_waiting", waiting);
}

// 记录系统资源指标
export function recordSystemMetrics() {
  const mem = process.memoryUsage();
  metrics.setGauge("nodejs_memory_heap_used_bytes", mem.heapUsed);
  metrics.setGauge("nodejs_memory_heap_total_bytes", mem.heapTotal);
  metrics.setGauge("nodejs_memory_external_bytes", mem.external);
  metrics.setGauge("nodejs_memory_rss_bytes", mem.rss);

  // 进程运行时间
  metrics.setGauge("nodejs_uptime_seconds", process.uptime());

  // 事件循环延迟（近似值）
  const start = Date.now();
  setImmediate(() => {
    const delay = Date.now() - start;
    metrics.setGauge("nodejs_eventloop_lag_ms", delay);
  });
}

// 启动定期记录系统指标（每 15 秒）
let systemMetricsInterval: ReturnType<typeof setInterval> | null = null;

export function startSystemMetricsCollection(intervalMs = 15000) {
  if (systemMetricsInterval) return;
  recordSystemMetrics();
  systemMetricsInterval = setInterval(recordSystemMetrics, intervalMs);
}

export function stopSystemMetricsCollection() {
  if (systemMetricsInterval) {
    clearInterval(systemMetricsInterval);
    systemMetricsInterval = null;
  }
}
