import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import Loading from '@/components/loading';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { configAPI, type AnthropicCountTokens, type AnthropicProxyIPConfig, testCountTokens } from '@/lib/api';
import { toast } from 'sonner';

const anthropicConfigSchema = z.object({
  base_url: z.string().min(1, { message: 'Base URL 不能为空' }),
  api_key: z.string().min(1, { message: 'API Key 不能为空' }),
  version: z.string().min(1, { message: 'Version 不能为空' }),
});

const embeddingConfigSchema = z.object({
  base_url: z.string().min(1, { message: 'Base URL 不能为空' }),
  api_key: z.string().min(1, { message: 'API Key 不能为空' }),
  model: z.string().min(1, { message: '模型名称不能为空' }),
});

const anthropicProxySchema = z.object({
  enabled: z.boolean(),
  proxy_ip: z.string().trim(),
}).refine((data) => !data.enabled || data.proxy_ip.length > 0, {
  message: '启用代理 IP 时必须填写代理 IP',
  path: ['proxy_ip'],
});

type AnthropicConfigForm = z.infer<typeof anthropicConfigSchema>;
type EmbeddingConfigForm = z.infer<typeof embeddingConfigSchema>;
type AnthropicProxyForm = z.infer<typeof anthropicProxySchema>;

interface EmbeddingConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export default function ConfigPage() {
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AnthropicCountTokens | null>(null);
  const [testing, setTesting] = useState(false);

  // Embedding 配置状态
  const [embeddingOpen, setEmbeddingOpen] = useState(false);
  const [embeddingConfig, setEmbeddingConfig] = useState<EmbeddingConfig | null>(null);
  const [embeddingTesting, setEmbeddingTesting] = useState(false);

  // Claude 代理 IP 配置状态
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyConfig, setProxyConfig] = useState<AnthropicProxyIPConfig | null>(null);

  const form = useForm<AnthropicConfigForm>({
    resolver: zodResolver(anthropicConfigSchema),
    defaultValues: {
      base_url: '',
      api_key: '',
      version: '2023-06-01',
    },
  });

  const embeddingForm = useForm<EmbeddingConfigForm>({
    resolver: zodResolver(embeddingConfigSchema),
    defaultValues: {
      base_url: '',
      api_key: '',
      model: 'text-embedding-3-small',
    },
  });

  const proxyForm = useForm<AnthropicProxyForm>({
    resolver: zodResolver(anthropicProxySchema),
    defaultValues: {
      enabled: false,
      proxy_ip: '',
    },
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setLoading(true);
        // 获取 Anthropic 配置
        const response = await configAPI.getConfig('anthropic_count_tokens');
        if (response.value) {
          const anthropicConfig = JSON.parse(response.value) as AnthropicCountTokens;
          setConfig(anthropicConfig);
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }

      try {
        // 获取 Embedding 配置
        const embeddingResponse = await configAPI.getConfig('embedding_config');
        if (embeddingResponse.value) {
          const embeddingCfg = JSON.parse(embeddingResponse.value) as EmbeddingConfig;
          setEmbeddingConfig(embeddingCfg);
        }
      } catch (error) {
        console.error('Failed to load embedding config:', error);
      }

      try {
        // 获取 Claude 代理 IP 配置
        const proxyResponse = await configAPI.getConfig('anthropic_proxy_ip');
        if (proxyResponse.value) {
          const proxyCfg = JSON.parse(proxyResponse.value) as AnthropicProxyIPConfig;
          setProxyConfig({
            enabled: Boolean(proxyCfg.enabled),
            proxy_ip: proxyCfg.proxy_ip || '',
          });
        }
      } catch (error) {
        console.error('Failed to load anthropic proxy config:', error);
      }

      setLoading(false);
    };

    fetchConfig();
  }, []);

  const openEditDialog = () => {
    form.reset({
      base_url: config?.base_url || 'https://api.anthropic.com/v1',
      api_key: config?.api_key || '',
      version: config?.version || '2023-06-01',
    });
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
  };

  const testConfig = async () => {
    try {
      setTesting(true);
      await testCountTokens();
      toast.success('配置检测成功');
    } catch (error) {
      console.error('Config test failed:', error);
      const errorMessage = error instanceof Error ? error.message : '检测失败';
      toast.error(`配置检测失败: ${errorMessage}`);
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = async (values: AnthropicConfigForm) => {
    try {
      await configAPI.updateConfig('anthropic_count_tokens', values);
      setConfig(values);
      toast.success('配置已保存');
      setOpen(false);
    } catch (error) {
      console.error('Failed to save config:', error);
      toast.error('保存配置失败');
    }
  };

  // Embedding 相关函数
  const openEmbeddingDialog = () => {
    embeddingForm.reset({
      base_url: embeddingConfig?.base_url || 'https://api.openai.com/v1',
      api_key: embeddingConfig?.api_key || '',
      model: embeddingConfig?.model || 'text-embedding-3-small',
    });
    setEmbeddingOpen(true);
  };

  const testEmbeddingConfig = async () => {
    if (!embeddingConfig) {
      toast.error('请先配置 Embedding');
      return;
    }
    try {
      setEmbeddingTesting(true);
      const token = localStorage.getItem('authToken');
      const res = await fetch('/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          input: 'Hello, world!',
          model: embeddingConfig.model,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.error?.message || '检测失败');
      }
      toast.success('Embedding 配置检测成功');
    } catch (error) {
      console.error('Embedding config test failed:', error);
      const errorMessage = error instanceof Error ? error.message : '检测失败';
      toast.error(`Embedding 配置检测失败: ${errorMessage}`);
    } finally {
      setEmbeddingTesting(false);
    }
  };

  const onEmbeddingSubmit = async (values: EmbeddingConfigForm) => {
    try {
      await configAPI.updateConfig('embedding_config', values);
      setEmbeddingConfig(values);
      toast.success('Embedding 配置已保存');
      setEmbeddingOpen(false);
    } catch (error) {
      console.error('Failed to save embedding config:', error);
      toast.error('保存 Embedding 配置失败');
    }
  };

  const openProxyDialog = () => {
    proxyForm.reset({
      enabled: proxyConfig?.enabled ?? false,
      proxy_ip: proxyConfig?.proxy_ip || '',
    });
    setProxyOpen(true);
  };

  const onProxySubmit = async (values: AnthropicProxyForm) => {
    try {
      await configAPI.updateConfig('anthropic_proxy_ip', values);
      setProxyConfig(values);
      toast.success('Claude 代理 IP 配置已保存');
      setProxyOpen(false);
    } catch (error) {
      console.error('Failed to save anthropic proxy config:', error);
      toast.error('保存 Claude 代理 IP 配置失败');
    }
  };

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 p-1">
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">系统配置</h2>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Anthropic 令牌计数配置</CardTitle>
            <CardDescription>
              配置 Anthropic API 用于令牌计数功能的连接信息
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Base URL</Label>
                <p className="text-sm text-muted-foreground break-all">
                  {config?.base_url || '未配置'}
                </p>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <p className="text-sm text-muted-foreground">
                  {config?.api_key ? (
                    <span className="font-mono">
                      {config.api_key.substring(0, 8)}...
                    </span>
                  ) : (
                    '未配置'
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label>API Version</Label>
                <p className="text-sm text-muted-foreground">
                  {config?.version || '未配置'}
                </p>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex justify-between">
            <Button onClick={openEditDialog}>编辑配置</Button>
            <Button
              type="button"
              variant="outline"
              onClick={testConfig}
              disabled={!config?.api_key || testing}
            >
              {testing ? (
                <>
                  <span className="inline-block w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                  检测中...
                </>
              ) : (
                '检测配置'
              )}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Claude 代理 IP 配置</CardTitle>
            <CardDescription>
              用于覆盖 Claude 接口转发请求的 X-Forwarded-For 与 X-Real-IP
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>启用状态</Label>
                <p className="text-sm text-muted-foreground">
                  {proxyConfig?.enabled ? '已启用' : '未启用'}
                </p>
              </div>
              <div className="space-y-2">
                <Label>代理 IP</Label>
                <p className="text-sm text-muted-foreground break-all">
                  {proxyConfig?.proxy_ip || '未配置'}
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button onClick={openProxyDialog}>编辑配置</Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Embedding 配置</CardTitle>
            <CardDescription>
              配置 Embedding API 用于文本向量化功能（OpenAI 兼容接口）
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Base URL</Label>
                <p className="text-sm text-muted-foreground break-all">
                  {embeddingConfig?.base_url || '未配置'}
                </p>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <p className="text-sm text-muted-foreground">
                  {embeddingConfig?.api_key ? (
                    <span className="font-mono">
                      {embeddingConfig.api_key.substring(0, 8)}...
                    </span>
                  ) : (
                    '未配置'
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label>默认模型</Label>
                <p className="text-sm text-muted-foreground">
                  {embeddingConfig?.model || '未配置'}
                </p>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex justify-between">
            <Button onClick={openEmbeddingDialog}>编辑配置</Button>
            <Button
              type="button"
              variant="outline"
              onClick={testEmbeddingConfig}
              disabled={!embeddingConfig?.api_key || embeddingTesting}
            >
              {embeddingTesting ? (
                <>
                  <span className="inline-block w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                  检测中...
                </>
              ) : (
                '检测配置'
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑 Anthropic 配置</DialogTitle>
            <DialogDescription>
              修改 Anthropic API 连接信息
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="base_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://api.anthropic.com/v1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="api_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input placeholder="sk-ant-..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="version"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Version</FormLabel>
                    <FormControl>
                      <Input placeholder="2023-06-01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  取消
                </Button>
                <Button type="submit">保存</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={proxyOpen} onOpenChange={setProxyOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑 Claude 代理 IP 配置</DialogTitle>
            <DialogDescription>
              启用后将覆盖转发请求的 X-Forwarded-For 与 X-Real-IP
            </DialogDescription>
          </DialogHeader>

          <Form {...proxyForm}>
            <form onSubmit={proxyForm.handleSubmit(onProxySubmit)} className="space-y-4">
              <FormField
                control={proxyForm.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
                    <FormLabel className="text-xs text-muted-foreground">启用代理 IP</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value === true}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={proxyForm.control}
                name="proxy_ip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>代理 IP</FormLabel>
                    <FormControl>
                      <Input placeholder="203.0.113.10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setProxyOpen(false)}>
                  取消
                </Button>
                <Button type="submit">保存</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={embeddingOpen} onOpenChange={setEmbeddingOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑 Embedding 配置</DialogTitle>
            <DialogDescription>
              配置 Embedding API 连接信息（支持 OpenAI 兼容接口）
            </DialogDescription>
          </DialogHeader>

          <Form {...embeddingForm}>
            <form onSubmit={embeddingForm.handleSubmit(onEmbeddingSubmit)} className="space-y-4">
              <FormField
                control={embeddingForm.control}
                name="base_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://api.openai.com/v1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={embeddingForm.control}
                name="api_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input placeholder="sk-..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={embeddingForm.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>默认模型</FormLabel>
                    <FormControl>
                      <Input placeholder="text-embedding-3-small" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEmbeddingOpen(false)}>
                  取消
                </Button>
                <Button type="submit">保存</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
