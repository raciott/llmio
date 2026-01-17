import { useState, useEffect, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import Loading from "@/components/loading";
import {
  getModelProviders,
  createModelProvider,
  updateModelProvider,
  updateModelProviderStatus,
  deleteModelProvider,
  getProviders,
  getProviderModels,
  testModelProvider,
} from "@/lib/api";
import type { ModelWithProvider, Model, Provider, ProviderModel } from "@/lib/api";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Zap, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

// 表单验证
const headerPairSchema = z.object({
  key: z.string().min(1, { message: "请求头键不能为空" }),
  value: z.string().default(""),
});

const formSchema = z.object({
  model_id: z.number().positive({ message: "模型ID必须大于0" }),
  provider_name: z.string().min(1, { message: "提供商模型名称不能为空" }),
  provider_id: z.number().positive({ message: "提供商ID必须大于0" }),
  tool_call: z.boolean(),
  structured_output: z.boolean(),
  image: z.boolean(),
  with_header: z.boolean(),
  weight: z.number().positive({ message: "权重必须大于0" }),
  customer_headers: z.array(headerPairSchema).default([]),
});

type FormValues = z.input<typeof formSchema>;

type ModelProvidersPanelProps = {
  embedded?: boolean;
  fixedModel?: Model | null;
};

export function ModelProvidersPanel({ embedded = false, fixedModel = null }: ModelProvidersPanelProps) {
  const [modelProviders, setModelProviders] = useState<ModelWithProvider[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerModelsMap, setProviderModelsMap] = useState<Record<number, ProviderModel[]>>({});
  const [providerModelsLoading, setProviderModelsLoading] = useState<Record<number, boolean>>({});
  const [showProviderModels, setShowProviderModels] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingAssociation, setEditingAssociation] = useState<ModelWithProvider | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { loading: boolean; result: any }>>({});
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);
  const [testType, setTestType] = useState<"connectivity" | "react">("connectivity");
  const [reactTestResult, setReactTestResult] = useState<{
    loading: boolean;
    messages: string;
    success: boolean | null;
    error: string | null;
  }>({
    loading: false,
    messages: "",
    success: null,
    error: null,
  });
  const [statusUpdating, setStatusUpdating] = useState<Record<number, boolean>>({});
  const [statusError, setStatusError] = useState<string | null>(null);

  const modelId = fixedModel?.ID ?? 0;
  const modelName = fixedModel?.Name ?? "模型提供商关联";

  const headerCardClass = embedded
    ? "rounded-2xl border border-border/60 bg-card/80 px-3 py-2 shadow-sm"
    : "rounded-3xl border border-border/60 bg-card/80 px-4 py-3 shadow-sm";
  const listWrapClass = embedded
    ? "flex-1 min-h-0 rounded-2xl border border-border/60 bg-background/80 p-2 shadow-sm"
    : "flex-1 min-h-0 rounded-3xl border border-border/60 bg-background/80 p-3 shadow-sm";
  const rowCardClass = embedded
    ? "group flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/40 px-2.5 py-2"
    : "group flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/40 px-3 py-2";
  const metaTextClass = embedded ? "text-[10px]" : "text-[11px]";
  const actionIconSize = embedded ? "h-7 w-7" : "h-8 w-8";
  const indexBadgeClass = embedded
    ? "size-6 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold flex items-center justify-center"
    : "size-7 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold flex items-center justify-center";

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      model_id: modelId || 0,
      provider_name: "",
      provider_id: 0,
      tool_call: true,
      structured_output: true,
      image: false,
      with_header: true,
      weight: 1,
      customer_headers: [],
    },
  });

  const { fields: headerFields, append: appendHeader, remove: removeHeader } = useFieldArray({
    control: form.control,
    name: "customer_headers",
  });

  useEffect(() => {
    if (!modelId) return;
    form.setValue("model_id", modelId);
  }, [modelId, form]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const providersData = await getProviders();
        setProviders(providersData);
        if (modelId) {
          const data = await getModelProviders(modelId);
          setModelProviders(
            data.map((item) => ({
              ...item,
              CustomerHeaders: item.CustomerHeaders || {},
            }))
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`获取模型提供商关联失败: ${message}`);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (modelId) {
      load();
    }
  }, [modelId]);

  const buildPayload = (values: FormValues) => {
    const headers: Record<string, string> = {};
    (values.customer_headers || []).forEach(({ key, value }) => {
      const trimmedKey = key.trim();
      if (trimmedKey) {
        headers[trimmedKey] = value ?? "";
      }
    });

    return {
      model_id: modelId || values.model_id,
      provider_name: values.provider_name,
      provider_id: values.provider_id,
      tool_call: values.tool_call,
      structured_output: values.structured_output,
      image: values.image,
      with_header: values.with_header,
      customer_headers: headers,
      weight: values.weight,
    };
  };

  const fetchModelProviders = async () => {
    if (!modelId) return;
    try {
      setLoading(true);
      const data = await getModelProviders(modelId);
      setModelProviders(
        data.map((item) => ({
          ...item,
          CustomerHeaders: item.CustomerHeaders || {},
        }))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`获取模型提供商关联失败: ${message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (values: FormValues) => {
    try {
      await createModelProvider(buildPayload(values));
      setOpen(false);
      toast.success("模型提供商关联创建成功");
      form.reset({
        model_id: modelId || 0,
        provider_name: "",
        provider_id: 0,
        tool_call: false,
        structured_output: false,
        image: false,
        with_header: false,
        weight: 1,
        customer_headers: [],
      });
      await fetchModelProviders();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`创建模型提供商关联失败: ${message}`);
      console.error(err);
    }
  };

  const handleUpdate = async (values: FormValues) => {
    if (!editingAssociation) return;
    try {
      await updateModelProvider(editingAssociation.ID, buildPayload(values));
      setOpen(false);
      toast.success("模型提供商关联更新成功");
      setEditingAssociation(null);
      form.reset({
        model_id: modelId || 0,
        provider_name: "",
        provider_id: 0,
        tool_call: false,
        structured_output: false,
        image: false,
        with_header: false,
        weight: 1,
        customer_headers: [],
      });
      await fetchModelProviders();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`更新模型提供商关联失败: ${message}`);
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteModelProvider(deleteId);
      setDeleteId(null);
      await fetchModelProviders();
      toast.success("模型提供商关联删除成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`删除模型提供商关联失败: ${message}`);
      console.error(err);
    }
  };

  const handleStatusToggle = async (association: ModelWithProvider, nextStatus: boolean) => {
    const previousStatus = association.Status ?? true;
    setStatusError(null);
    setStatusUpdating((prev) => ({ ...prev, [association.ID]: true }));
    setModelProviders((prev) =>
      prev.map((item) =>
        item.ID === association.ID ? { ...item, Status: nextStatus } : item
      )
    );

    try {
      const updated = await updateModelProviderStatus(association.ID, nextStatus);
      const normalized = { ...updated, CustomerHeaders: updated.CustomerHeaders || {} };
      setModelProviders((prev) =>
        prev.map((item) =>
          item.ID === association.ID ? normalized : item
        )
      );
    } catch (err) {
      setModelProviders((prev) =>
        prev.map((item) =>
          item.ID === association.ID ? { ...item, Status: previousStatus } : item
        )
      );
      setStatusError("更新启用状态失败");
      console.error(err);
    } finally {
      setStatusUpdating((prev) => {
        const next = { ...prev };
        delete next[association.ID];
        return next;
      });
    }
  };

  const handleTest = (id: number) => {
    currentControllerRef.current?.abort();
    setSelectedTestId(id);
    setTestType("connectivity");
    setTestDialogOpen(true);
    setReactTestResult({
      loading: false,
      messages: "",
      success: null,
      error: null,
    });
  };

  const handleConnectivityTest = async (id: number) => {
    try {
      setTestResults((prev) => ({
        ...prev,
        [id]: { loading: true, result: null },
      }));

      const result = await testModelProvider(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: { loading: false, result },
      }));
      return result;
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { loading: false, result: { error: "测试失败" + err } },
      }));
      console.error(err);
      return { error: "测试失败" + err };
    }
  };

  const currentControllerRef = useRef<AbortController | null>(null);
  const handleReactTest = async (id: number) => {
    setReactTestResult((prev) => ({
      ...prev,
      messages: "",
      loading: true,
    }));
    try {
      const token = localStorage.getItem("authToken");
      const controller = new AbortController();
      currentControllerRef.current = controller;
      await fetchEventSource(`/api/test/react/${id}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
        signal: controller.signal,
        onmessage(event) {
          setReactTestResult((prev) => {
            if (event.event === "start") {
              return {
                ...prev,
                messages: prev.messages + `[开始测试] ${event.data}\n`,
              };
            } else if (event.event === "toolcall") {
              return {
                ...prev,
                messages: prev.messages + `\n[调用工具] ${event.data}\n`,
              };
            } else if (event.event === "toolres") {
              return {
                ...prev,
                messages: prev.messages + `\n[工具输出] ${event.data}\n`,
              };
            } else if (event.event === "message") {
              if (event.data.trim()) {
                return {
                  ...prev,
                  messages: prev.messages + `${event.data}`,
                };
              }
            } else if (event.event === "error") {
              return {
                ...prev,
                success: false,
                messages: prev.messages + `\n[错误] ${event.data}\n`,
              };
            } else if (event.event === "success") {
              return {
                ...prev,
                success: true,
                messages: prev.messages + `\n[成功] ${event.data}`,
              };
            }
            return prev;
          });
        },
        onclose() {
          setReactTestResult((prev) => ({
            ...prev,
            loading: false,
          }));
        },
        onerror(err) {
          setReactTestResult((prev) => ({
            ...prev,
            loading: false,
            error: err.message || "测试过程中发生错误",
            success: false,
          }));
          throw err;
        },
      });
    } catch (err) {
      setReactTestResult((prev) => ({
        ...prev,
        loading: false,
        error: "测试失败",
        success: false,
      }));
      console.error(err);
    }
  };

  const executeTest = async () => {
    if (!selectedTestId) return;

    if (testType === "connectivity") {
      await handleConnectivityTest(selectedTestId);
    } else {
      await handleReactTest(selectedTestId);
    }
  };

  const openEditDialog = (association: ModelWithProvider) => {
    setEditingAssociation(association);
    const headerPairs = Object.entries(association.CustomerHeaders || {}).map(([key, value]) => ({
      key,
      value,
    }));
    form.reset({
      model_id: modelId || association.ModelID,
      provider_name: association.ProviderModel,
      provider_id: association.ProviderID,
      tool_call: association.ToolCall === true,
      structured_output: association.StructuredOutput === true,
      image: association.Image === true,
      with_header: association.WithHeader === true,
      weight: association.Weight,
      customer_headers: headerPairs.length ? headerPairs : [],
    });
    setOpen(true);
  };

  const openCreateDialog = () => {
    setEditingAssociation(null);
    form.reset({
      model_id: modelId || 0,
      provider_name: "",
      provider_id: 0,
      tool_call: false,
      structured_output: false,
      image: false,
      with_header: false,
      weight: 1,
      customer_headers: [],
    });
    setOpen(true);
  };

  const openDeleteDialog = (id: number) => {
    setDeleteId(id);
  };

  const loadProviderModels = async (providerId: number, force = false) => {
    if (!providerId) return;
    if (!force && providerModelsMap[providerId]) return;

    setProviderModelsLoading((prev) => ({ ...prev, [providerId]: true }));
    try {
      const data = await getProviderModels(providerId);
      setProviderModelsMap((prev) => ({ ...prev, [providerId]: data }));
    } catch (err) {
      toast.warning(`获取提供商模型列表失败: ${err}`);
      setProviderModelsMap((prev) => ({ ...prev, [providerId]: [] }));
    } finally {
      setProviderModelsLoading((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
    }
  };

  const selectedProviderId = form.watch("provider_id");

  useEffect(() => {
    if (selectedProviderId && selectedProviderId > 0) {
      loadProviderModels(selectedProviderId);
    }
    setShowProviderModels(false);
  }, [selectedProviderId]);

  const sortProviderModels = (providerId: number, query: string): ProviderModel[] => {
    const models = providerModelsMap[providerId] || [];
    if (!query) return models;

    const normalized = query.toLowerCase();
    const score = (id: string) => {
      const val = id.toLowerCase();
      if (val === normalized) return 1000;
      let s = 0;
      if (val.startsWith(normalized)) s += 500;
      if (val.includes(normalized)) s += 200;
      s -= Math.abs(val.length - normalized.length);
      return s;
    };

    return [...models].sort((a, b) => score(b.id) - score(a.id));
  };

  if (!modelId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        请从模型管理进入模型提供商关联
      </div>
    );
  }

  return (
    <div className={`h-full min-h-0 flex flex-col ${embedded ? "p-0" : "p-1"}`}>
      <div className="flex flex-col gap-3">
        <div className={headerCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className={`truncate ${embedded ? "text-base font-semibold" : "text-lg font-semibold"}`}>
                {modelName}
              </h2>
              <p className={`text-muted-foreground ${embedded ? "text-[11px]" : "text-xs"}`}>
                模型提供商关联
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className={`${actionIconSize} rounded-full`}
              onClick={openCreateDialog}
              aria-label="添加关联"
              title="添加关联"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        {statusError && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {statusError}
          </div>
        )}

        <div className={listWrapClass}>
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loading message="加载关联数据" />
            </div>
          ) : modelProviders.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm text-center px-6">
              暂无关联数据
            </div>
          ) : (
            <div className={`flex-1 min-h-0 overflow-y-auto space-y-2 ${embedded ? "max-h-[55vh]" : ""}`}>
              {modelProviders.map((association, index) => {
                const provider = providers.find((p) => p.ID === association.ProviderID);
                const isAssociationEnabled = association.Status ?? true;
                return (
                  <div key={association.ID} className={rowCardClass}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={indexBadgeClass}>{index + 1}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`font-semibold truncate max-w-[20ch] ${embedded ? "text-sm" : ""}`}
                            title={association.ProviderModel}
                          >
                            {association.ProviderModel}
                          </span>
                          <span className={`truncate text-muted-foreground ${embedded ? "text-[11px]" : "text-xs"}`}>
                            {provider?.Name ?? "未知提供商"}
                          </span>
                        </div>
                        <div className={`mt-1 flex items-center gap-2 text-muted-foreground ${metaTextClass}`}>
                          <span className="rounded-full bg-background/70 px-2 py-0.5">
                            {provider?.Type ?? "未知类型"}
                          </span>
                          <span className="rounded-full bg-background/70 px-2 py-0.5">
                            权重 {association.Weight}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={isAssociationEnabled}
                        disabled={!!statusUpdating[association.ID]}
                        onCheckedChange={(value) => handleStatusToggle(association, value)}
                        aria-label="切换启用状态"
                      />
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`${actionIconSize} rounded-full`}
                          onClick={() => openEditDialog(association)}
                          aria-label="编辑关联"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`${actionIconSize} rounded-full`}
                          onClick={() => handleTest(association.ID)}
                          aria-label="测试关联"
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                        <AlertDialog open={deleteId === association.ID} onOpenChange={(open) => !open && setDeleteId(null)}>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`${actionIconSize} rounded-full text-destructive hover:text-destructive`}
                              onClick={() => openDeleteDialog(association.ID)}
                              aria-label="删除关联"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确定要删除这个关联吗？</AlertDialogTitle>
                              <AlertDialogDescription>
                                此操作无法撤销。这将永久删除该模型提供商关联。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setDeleteId(null)}>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={handleDelete}>确认删除</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingAssociation ? "编辑关联" : "添加关联"}</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(editingAssociation ? handleUpdate : handleCreate)} className="flex flex-col gap-4 flex-1 min-h-0">
              <div className="space-y-4 overflow-y-auto pr-1 sm:pr-2 max-h-[60vh] flex-1 min-h-0">
                <div className="grid grid-cols-2 gap-3">
                  <FormItem className="min-w-0">
                    <FormLabel>模型</FormLabel>
                    <Input value={modelName} disabled />
                  </FormItem>
                  <FormField
                    control={form.control}
                    name="provider_id"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>提供商</FormLabel>
                        <Select
                          value={field.value ? field.value.toString() : ""}
                          onValueChange={(value) => {
                            const parsed = parseInt(value);
                            field.onChange(parsed);
                            form.setValue("provider_name", "");
                          }}
                        >
                          <FormControl>
                            <SelectTrigger className="form-select w-full">
                              <SelectValue placeholder="选择提供商" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {providers.map((provider) => (
                              <SelectItem key={provider.ID} value={provider.ID.toString()}>
                                {provider.Name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="provider_name"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel>提供商模型</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            placeholder="输入或选择提供商模型"
                            onFocus={() => setShowProviderModels(true)}
                            onBlur={() => setTimeout(() => setShowProviderModels(false), 100)}
                            onChange={(e) => {
                              field.onChange(e.target.value);
                              setShowProviderModels(true);
                            }}
                          />
                          {showProviderModels && (providerModelsMap[selectedProviderId] || []).length > 0 && (
                            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-sm max-h-52 overflow-y-auto">
                              {sortProviderModels(selectedProviderId, field.value || "").map((model) => (
                                <button
                                  key={model.id}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    field.onChange(model.id);
                                    setShowProviderModels(false);
                                  }}
                                >
                                  {model.id}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      {selectedProviderId ? (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <p>可直接输入，或在下拉列表中选择</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => loadProviderModels(selectedProviderId, true)}
                            disabled={!!providerModelsLoading[selectedProviderId]}
                          >
                            {providerModelsLoading[selectedProviderId] ? (
                              <Spinner className="size-4" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">请选择提供商以加载模型列表</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormLabel>模型能力</FormLabel>
                <FormField
                  control={form.control}
                  name="tool_call"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>工具调用</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="structured_output"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>结构化输出</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="image"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>视觉</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <FormLabel>参数配置</FormLabel>
                <FormField
                  control={form.control}
                  name="with_header"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>请求头透传</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="customer_headers"
                  render={({ field }) => {
                    const headerValues = field.value ?? [];
                    return (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel>自定义请求头</FormLabel>
                          <Button type="button" variant="outline" size="sm" onClick={() => appendHeader({ key: "", value: "" })}>
                            添加
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {headerFields.map((header, index) => {
                            const errorMsg = form.formState.errors.customer_headers?.[index]?.key?.message;
                            return (
                              <div key={header.id} className="space-y-1">
                                <div className="flex gap-2 items-center">
                                  <div className="flex-1">
                                    <Input
                                      placeholder="Header Key"
                                      value={headerValues[index]?.key ?? ""}
                                      onChange={(e) => {
                                        const next = [...headerValues];
                                        next[index] = { ...next[index], key: e.target.value };
                                        field.onChange(next);
                                      }}
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <Input
                                      placeholder="Header Value"
                                      value={headerValues[index]?.value ?? ""}
                                      onChange={(e) => {
                                        const next = [...headerValues];
                                        next[index] = { ...next[index], value: e.target.value };
                                        field.onChange(next);
                                      }}
                                    />
                                  </div>
                                  <Button type="button" size="sm" variant="destructive" onClick={() => removeHeader(index)}>
                                    删除
                                  </Button>
                                </div>
                                {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}
                              </div>
                            );
                          })}
                          <p className="text-sm text-muted-foreground">
                            {"优先级: 提供商配置 > 自定义请求头 > 透传请求头"}
                          </p>
                        </div>
                      </FormItem>
                    );
                  }}
                />

                <FormField
                  control={form.control}
                  name="weight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>权重 (必须大于0)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="1"
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="submit">{editingAssociation ? "更新" : "创建"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>模型测试</DialogTitle>
            <DialogDescription>选择要执行的测试类型</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="testType"
                checked={testType === "connectivity"}
                onChange={() => setTestType("connectivity")}
              />
              连通性测试
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="testType"
                checked={testType === "react"}
                onChange={() => setTestType("react")}
              />
              React Agent 能力测试
            </label>
          </div>

          {testType === "connectivity" && (
            <div className="mt-4">
              {selectedTestId && testResults[selectedTestId]?.loading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  <span className="ml-2">测试中...</span>
                </div>
              ) : selectedTestId && testResults[selectedTestId] ? (
                <div className={`p-4 rounded-md ${testResults[selectedTestId].result?.error ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>
                  <p>{testResults[selectedTestId].result?.error ? testResults[selectedTestId].result?.error : "测试成功"}</p>
                  {testResults[selectedTestId].result?.message && (
                    <p className="mt-2">{testResults[selectedTestId].result.message}</p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500">点击"执行测试"开始测试</p>
              )}
            </div>
          )}

          {testType === "react" && (
            <div className="mt-4 max-h-96 min-w-0">
              {reactTestResult.loading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  <span className="ml-2">测试中...</span>
                </div>
              ) : (
                <>
                  {reactTestResult.error ? (
                    <div className="p-4 rounded-md bg-red-100 text-red-800">
                      <p>测试失败: {reactTestResult.error}</p>
                    </div>
                  ) : reactTestResult.success !== null ? (
                    <div className={`p-4 rounded-md ${reactTestResult.success ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                      <p>{reactTestResult.success ? "测试成功！" : "测试失败"}</p>
                    </div>
                  ) : null}
                </>
              )}

              {reactTestResult.messages && (
                <Textarea
                  name="logs"
                  className="mt-4 max-h-50 resize-none whitespace-pre overflow-x-auto"
                  readOnly
                  value={reactTestResult.messages}
                />
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              关闭
            </Button>
            <Button
              onClick={executeTest}
              disabled={testType === "connectivity"
                ? (selectedTestId ? testResults[selectedTestId]?.loading : false)
                : reactTestResult.loading}
            >
              {testType === "connectivity"
                ? (selectedTestId && testResults[selectedTestId]?.loading ? "测试中..." : "执行测试")
                : (reactTestResult.loading ? "测试中..." : "执行测试")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ModelProvidersPage() {
  return <ModelProvidersPanel />;
}
