import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { configAPI, type AnthropicProxyIPConfig, type ModelPriceSyncConfig } from '@/lib/api';
import { toast } from 'sonner';
import { Settings, Network, Coins } from 'lucide-react';

const anthropicProxySchema = z.object({
  enabled: z.boolean(),
  proxy_ip: z.string().trim(),
}).refine((data) => !data.enabled || data.proxy_ip.length > 0, {
  message: '启用代理 IP 时必须填写代理 IP',
  path: ['proxy_ip'],
});

const priceSyncSchema = z.object({
  enabled: z.boolean(),
  interval_minutes: z.number().min(1, { message: '执行间隔必须大于 0' }),
  source_url: z.string().trim(),
});

type AnthropicProxyForm = z.infer<typeof anthropicProxySchema>;
type PriceSyncForm = z.infer<typeof priceSyncSchema>;

export default function ConfigPage() {
  const [loading, setLoading] = useState(true);
  const proxyForm = useForm<AnthropicProxyForm>({
    resolver: zodResolver(anthropicProxySchema),
    defaultValues: {
      enabled: false,
      proxy_ip: '',
    },
  });

  const priceSyncForm = useForm<PriceSyncForm>({
    resolver: zodResolver(priceSyncSchema),
    defaultValues: {
      enabled: true,
      interval_minutes: 1440,
      source_url: 'https://models.dev/api.json',
    },
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setLoading(true);
        // 获取全局代理 IP 配置
        const proxyResponse = await configAPI.getConfig('anthropic_proxy_ip');
        if (proxyResponse.value) {
          const proxyCfg = JSON.parse(proxyResponse.value) as AnthropicProxyIPConfig;
          const nextProxyConfig = {
            enabled: Boolean(proxyCfg.enabled),
            proxy_ip: proxyCfg.proxy_ip || '',
          };
          proxyForm.reset(nextProxyConfig);
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }

      try {
        // 获取模型价格同步配置
        const priceSyncResponse = await configAPI.getConfig('model_price_sync');
        if (priceSyncResponse.value) {
          const priceSyncCfg = JSON.parse(priceSyncResponse.value) as ModelPriceSyncConfig;
          const nextPriceSyncConfig = {
            enabled: Boolean(priceSyncCfg.enabled),
            interval_minutes: Number(priceSyncCfg.interval_minutes || 1440),
            source_url: priceSyncCfg.source_url || 'https://models.dev/api.json',
          };
          priceSyncForm.reset(nextPriceSyncConfig);
        }
      } catch (error) {
        console.error('Failed to load model price sync config:', error);
      }

      setLoading(false);
    };

    fetchConfig();
  }, []);

  const onProxySubmit = async (values: AnthropicProxyForm) => {
    try {
      await configAPI.updateConfig('anthropic_proxy_ip', values);
      toast.success('全局代理 IP 配置已保存');
    } catch (error) {
      console.error('Failed to save anthropic proxy config:', error);
      toast.error('保存全局代理 IP 配置失败');
    }
  };

  const onPriceSyncSubmit = async (values: PriceSyncForm) => {
    try {
      await configAPI.updateConfig('model_price_sync', values);
      toast.success('模型价格同步配置已保存');
    } catch (error) {
      console.error('Failed to save model price sync config:', error);
      toast.error('保存模型价格同步配置失败');
    }
  };

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 p-1">
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Settings className="size-4" />
            </span>
            <h2 className="text-2xl font-bold tracking-tight">设置</h2>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-[0_18px_45px_rgba(0,0,0,0.08)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Network className="size-4 text-emerald-600" />
                全局代理 IP 配置
              </CardTitle>
              <CardDescription className="text-xs">
                用于覆盖所有接口转发请求的 X-Forwarded-For 与 X-Real-IP
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Form {...proxyForm}>
                <form id="proxy-form" onSubmit={proxyForm.handleSubmit(onProxySubmit)} className="space-y-4">
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
                </form>
              </Form>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button type="submit" form="proxy-form">保存配置</Button>
            </CardFooter>
          </Card>

          <Card className="rounded-2xl border border-border/60 bg-card/90 shadow-[0_18px_45px_rgba(0,0,0,0.08)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Coins className="size-4 text-emerald-600" />
                模型价格同步配置
              </CardTitle>
              <CardDescription className="text-xs">
                配置模型价格表的定时同步间隔
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Form {...priceSyncForm}>
                <form id="price-sync-form" onSubmit={priceSyncForm.handleSubmit(onPriceSyncSubmit)} className="space-y-4">
                  <FormField
                    control={priceSyncForm.control}
                    name="enabled"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
                        <FormLabel className="text-xs text-muted-foreground">启用同步</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value === true}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={priceSyncForm.control}
                      name="interval_minutes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>执行间隔（分钟）</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              value={field.value}
                              onChange={(event) => field.onChange(Number(event.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={priceSyncForm.control}
                      name="source_url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>数据源</FormLabel>
                          <FormControl>
                            <Input placeholder="https://models.dev/api.json" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </form>
              </Form>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button type="submit" form="price-sync-form">保存配置</Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
