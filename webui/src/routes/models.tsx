import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import Loading from "@/components/loading";
import {
  getModels,
  createModel,
  updateModel,
  updateModelStatus,
  deleteModel,
} from "@/lib/api";
import type { Model } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { ModelProvidersPanel } from "@/routes/model-providers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Timer,
} from "lucide-react";
import hunyuanIcon from "@/assets/modelIcon/hunyuan.svg";
import doubaoIcon from "@/assets/modelIcon/doubao.svg";
import grokIcon from "@/assets/modelIcon/grok.svg";
import qwenIcon from "@/assets/modelIcon/qwen.svg";
import minimaxIcon from "@/assets/modelIcon/minimax.svg";
import openaiIcon from "@/assets/modelIcon/openai.svg";
import claudeIcon from "@/assets/modelIcon/claude.svg";
import geminiIcon from "@/assets/modelIcon/gemini.svg";

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
];

const ModelIcon = ({ name }: { name: string }) => {
  const config = modelIconConfigs.find((item) => item.test.test(name));
  const fallback = (name || "M").slice(0, 2).toUpperCase();

  if (!config) {
    return (
      <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
        {fallback}
      </div>
    );
  }

  return (
    <div className="size-12 rounded-full bg-muted/60 flex items-center justify-center">
      <img src={config.src} alt={config.alt} className="size-6" />
    </div>
  );
};

// 定义表单验证模式
const formSchema = z.object({
  name: z.string().min(1, { message: "模型名称不能为空" }),
  remark: z.string(),
  max_retry: z.number().min(0, { message: "重试次数限制不能为负数" }),
  time_out: z.number().min(0, { message: "超时时间不能为负数" }),
  io_log: z.boolean(),
  strategy: z.enum(["lottery", "rotor"]),
  breaker: z.boolean(),
  status: z.boolean(),
});

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [pages, setPages] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [providerPanelOpen, setProviderPanelOpen] = useState(false);
  const [providerPanelModel, setProviderPanelModel] = useState<Model | null>(null);

  // 初始化表单
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      remark: "",
      max_retry: 10,
      time_out: 60,
      io_log: false,
      strategy: "lottery",
      breaker: false,
      status: true,
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const response = await getModels({
        page,
        page_size: pageSize,
        search: searchTerm || undefined,
      });
      setModels(response.data);
      setPages(response.pages);
      const totalPages = response.pages || 0;
      if (totalPages > 0 && page > totalPages) {
        setPage(totalPages);
      } else if (totalPages === 0 && page !== 1) {
        setPage(1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取模型列表失败: ${message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, [page, pageSize, searchTerm]);

  const handleCreate = async (values: z.infer<typeof formSchema>) => {
    try {
      await createModel({
        name: values.name,
        remark: values.remark,
        max_retry: values.max_retry,
        time_out: values.time_out,
        io_log: values.io_log,
        strategy: values.strategy,
        breaker: values.breaker,
      });
      setOpen(false);
      toast.success(`模型: ${values.name} 创建成功`);
      form.reset({ name: "", remark: "", max_retry: 10, time_out: 60, io_log: false, strategy: "lottery", breaker: false });
      await fetchModels();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`创建模型失败: ${message}`);
    }
  };

  const handleUpdate = async (values: z.infer<typeof formSchema>) => {
    if (!editingModel) return;
    try {
      await updateModel(editingModel.ID, {
        name: values.name,
        remark: values.remark,
        max_retry: values.max_retry,
        time_out: values.time_out,
        io_log: values.io_log,
        strategy: values.strategy,
        breaker: values.breaker,
      });
      const previousEnabled = editingModel.Status == null ? true : Number(editingModel.Status) === 1;
      if (previousEnabled !== values.status) {
        await updateModelStatus(editingModel.ID, values.status);
      }
      setOpen(false);
      toast.success(`模型: ${values.name} 更新成功`);
      setEditingModel(null);
      form.reset({ name: "", remark: "", max_retry: 10, time_out: 60, io_log: false, strategy: "lottery", breaker: false, status: true });
      await fetchModels();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`更新模型失败: ${message}`);
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const targetModel = models.find((model) => model.ID === deleteId);
      await deleteModel(deleteId);
      setDeleteId(null);
      await fetchModels();
      toast.success(`模型: ${targetModel?.Name ?? deleteId} 删除成功`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`删除模型失败: ${message}`);
      console.error(err);
    }
  };

  const openEditDialog = (model: Model) => {
    setEditingModel(model);
    const statusEnabled = model.Status == null ? true : Number(model.Status) === 1;
    form.reset({
      name: model.Name,
      remark: model.Remark,
      max_retry: model.MaxRetry,
      time_out: model.TimeOut,
      io_log: Boolean(model.IOLog),
      strategy: model.Strategy === "rotor" ? "rotor" : "lottery",
      breaker: Boolean(model.Breaker),
      status: statusEnabled,
    });
    setOpen(true);
  };

  const openProviderPanel = (model: Model) => {
    setProviderPanelModel(model);
    setProviderPanelOpen(true);
  };

  const openCreateDialog = () => {
    setEditingModel(null);
    form.reset({ name: "", remark: "", max_retry: 10, time_out: 60, io_log: false, strategy: "lottery", breaker: false, status: true });
    setOpen(true);
  };

  const openDeleteDialog = (id: number) => {
    setDeleteId(id);
  };

  const handlePageChange = (nextPage: number) => {
    const maxPage = Math.max(pages, 1);
    if (nextPage < 1 || nextPage > maxPage) return;
    setPage(nextPage);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 p-1">
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">模型管理</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索模型"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="h-8 w-44 rounded-full pl-9 text-xs bg-muted/60 border-transparent focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full bg-muted/60 text-foreground hover:bg-muted/80"
              onClick={openCreateDialog}
              aria-label="添加模型"
              title="添加模型"
            >
              <Plus className="size-4" />
            </Button>
            <div className="flex items-center gap-1 rounded-full bg-muted/60 px-2 py-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                aria-label="上一页"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {page}/{Math.max(pages, 1)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                onClick={() => handlePageChange(page + 1)}
                disabled={page === pages || pages === 0}
                aria-label="下一页"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 border rounded-md bg-background shadow-sm">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loading message="加载模型列表" />
          </div>
        ) : models.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            暂无模型数据
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {models.map((model) => {
                  return (
                    <Card
                      key={model.ID}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProviderPanel(model)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openProviderPanel(model);
                        }
                      }}
                      className="flex-row items-center gap-3 py-3 px-3 rounded-2xl border border-border/60 bg-card/80 shadow-sm cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <ModelIcon name={model.Name} />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{model.Name}</div>
                          {model.Remark ? (
                            <div className="text-[11px] text-muted-foreground truncate" title={model.Remark}>
                              {model.Remark}
                            </div>
                          ) : null}
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <RefreshCw className="size-3 text-blue-500" />
                              <span>重试次数 {model.MaxRetry}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Timer className="size-3 text-amber-500" />
                              <span>超时 {model.TimeOut}s</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditDialog(model);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDeleteDialog(model.ID);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确定要删除这个模型吗？</AlertDialogTitle>
                              <AlertDialogDescription>此操作无法撤销。这将永久删除该模型。</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setDeleteId(null)}>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={handleDelete}>确认删除</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingModel ? "编辑模型" : "添加模型"}
            </DialogTitle>
            <DialogDescription>
              {editingModel
                ? "修改模型信息"
                : "添加一个新的模型"}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(editingModel ? handleUpdate : handleCreate)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>名称</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-9" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {editingModel ? (
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
                        <FormLabel className="text-xs text-muted-foreground">启用</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value === true}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                            aria-label="切换模型启用状态"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>

              <FormField
                control={form.control}
                name="remark"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>备注</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="max_retry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>重试次数</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          className="h-9"
                          {...field}
                          onChange={e => field.onChange(+e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="time_out"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>超时(秒)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          className="h-9"
                          {...field}
                          onChange={e => field.onChange(+e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="io_log"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
                      <FormLabel className="text-xs text-muted-foreground">IO 记录</FormLabel>
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
                  control={form.control}
                  name="breaker"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
                      <FormLabel className="text-xs text-muted-foreground">熔断</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value === true}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="strategy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>负载均衡策略</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="选择策略" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="lottery">抽签（权重随机）</SelectItem>
                        <SelectItem value="rotor">轮转（权重轮询）</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="submit">
                  {editingModel ? "更新" : "创建"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={providerPanelOpen}
        onOpenChange={(nextOpen) => {
          setProviderPanelOpen(nextOpen);
          if (!nextOpen) {
            setProviderPanelModel(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl max-h-[88vh] p-4 overflow-hidden">
          {providerPanelModel ? (
            <ModelProvidersPanel embedded fixedModel={providerPanelModel} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
