import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";

export type ConfigValueType = "string" | "number" | "boolean" | "json";

export type ConfigItem = {
	id: string;
	key: string;
	type: ConfigValueType;
	value: string;
	locked?: boolean;
};

type Props = {
	value: string;
	onChange: (nextJson: string) => void;
	providerType?: string;
};

const BASE_DEFAULT_ITEMS: Omit<ConfigItem, "id">[] = [
	{ key: "base_url", type: "string", value: "", locked: true },
	{ key: "api_key", type: "string", value: "", locked: true },
];

function defaultItemsByType(providerType?: string): Omit<ConfigItem, "id">[] {
	if (providerType === "anthropic") {
		return BASE_DEFAULT_ITEMS.concat([
			// 对应请求头 anthropic-version
			{ key: "version", type: "string", value: "2023-06-01", locked: true },
		]);
	}
	return BASE_DEFAULT_ITEMS;
}

function newId() {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeJsonToItems(raw: string, defaults: Omit<ConfigItem, "id">[]): { items: ConfigItem[]; isJson: boolean } {
	if (!raw) {
		return {
			items: defaults.map(item => ({ ...item, id: newId() })),
			isJson: true,
		};
	}
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("not-object");
		}

		const baseItems: ConfigItem[] = defaults.map(item => ({
			...item,
			id: newId(),
		}));

		const seen = new Set<string>(baseItems.map(i => i.key));

		// 保留 JSON 中存在但不在默认字段中的额外字段
		for (const [k, v] of Object.entries(parsed)) {
			if (seen.has(k)) continue;
			const t: ConfigValueType =
				typeof v === "boolean" ? "boolean" :
				typeof v === "number" ? "number" :
				typeof v === "string" ? "string" :
				"json";

			const value = t === "json" ? JSON.stringify(v, null, 2) : String(v);
			baseItems.push({ id: newId(), key: k, type: t, value, locked: false });
			seen.add(k);
		}

		// 将默认字段的值覆盖为 JSON 中的实际值（若存在）
		for (const item of baseItems) {
			if (!Object.prototype.hasOwnProperty.call(parsed, item.key)) continue;
			const v = (parsed as Record<string, unknown>)[item.key];
			if (item.key === "version") {
				item.type = "string";
				item.value = String(v ?? "");
			} else {
				item.type = "string";
				item.value = String(v ?? "");
			}
		}

		return { items: baseItems, isJson: true };
	} catch {
		return {
			items: defaults.map(item => ({ ...item, id: newId() })),
			isJson: false,
		};
	}
}

function serializeItems(items: ConfigItem[], providerType?: string): { json: string; error: string | null } {
	const obj: Record<string, unknown> = {};
	for (const item of items) {
		const key = item.key.trim();
		if (!key) return { json: "", error: "存在空的配置键名" };

		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			return { json: "", error: `存在重复的配置键名: ${key}` };
		}

		if (item.type === "boolean") {
			obj[key] = item.value === "true";
			continue;
		}

		if (item.type === "number") {
			const n = Number(item.value);
			if (!Number.isFinite(n)) return { json: "", error: `字段 ${key} 不是合法数字` };
			obj[key] = n;
			continue;
		}

		if (item.type === "json") {
			try {
				obj[key] = JSON.parse(item.value || "null");
			} catch {
				return { json: "", error: `字段 ${key} 的 JSON 格式不正确` };
			}
			continue;
		}

		obj[key] = item.value ?? "";
	}

	if (providerType === "anthropic") {
		const version = String(obj["version"] ?? "").trim();
		if (!version) return { json: "", error: "Anthropic 必须配置 anthropic-version（字段名：version）" };
	}

	return { json: JSON.stringify(obj, null, 2), error: null };
}

type Mode = "visual" | "json";

export default function ProviderConfigEditor({ value, onChange, providerType }: Props) {
	const defaults = useMemo(() => defaultItemsByType(providerType), [providerType]);

	const lastEmittedRef = useRef<string | null>(null);
	const lastDefaultsRef = useRef<Omit<ConfigItem, "id">[]>(defaults);
	const [mode, setMode] = useState<Mode>(() => {
		const normalized = normalizeJsonToItems(value, defaults);
		return normalized.isJson ? "visual" : "json";
	});
	const [items, setItems] = useState<ConfigItem[]>(() => normalizeJsonToItems(value, defaults).items);
	const [rawText, setRawText] = useState<string>(() => value);
	const [rawParseError, setRawParseError] = useState<string | null>(null);

	useEffect(() => {
		// 外部变化（例如切换类型/打开编辑不同 provider）：同步到内部状态
		const defaultsChanged = defaults !== lastDefaultsRef.current;
		lastDefaultsRef.current = defaults;

		// 如果 value 没变且 defaults 也没变，跳过
		if (value === lastEmittedRef.current && !defaultsChanged) return;

		// 使用当前的 value（包含用户已填的数据）重新解析，保留额外字段
		const normalized = normalizeJsonToItems(value, defaults);
		setItems(normalized.items);
		setRawText(value);
		setRawParseError(null);
		setMode(normalized.isJson ? "visual" : "json");
	}, [value, defaults]);

	const { json, error } = useMemo(() => serializeItems(items, providerType), [items, providerType]);

	useEffect(() => {
		if (mode !== "visual") return;
		if (error) return;
		lastEmittedRef.current = json;
		onChange(json);
	}, [json, error, onChange, mode]);

	const updateItem = (id: string, patch: Partial<ConfigItem>) => {
		setItems(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)));
	};

	const addItem = () => {
		setItems(prev => prev.concat([{ id: newId(), key: "", type: "string", value: "" }]));
	};

	const removeItem = (id: string) => {
		setItems(prev => prev.filter(item => item.id !== id));
	};

	const applyRawToVisual = () => {
		try {
			const parsed = JSON.parse(rawText);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				setRawParseError("必须是 JSON 对象（例如 {\"base_url\":\"...\"}）");
				return;
			}
			const normalized = normalizeJsonToItems(JSON.stringify(parsed), defaults);
			setItems(normalized.items);
			const { json: nextJson, error: nextErr } = serializeItems(normalized.items, providerType);
			if (nextErr) {
				setRawParseError(nextErr);
				return;
			}
			lastEmittedRef.current = nextJson;
			onChange(nextJson);
			setRawParseError(null);
			setMode("visual");
		} catch {
			setRawParseError("JSON 解析失败，请检查格式");
		}
	};

	if (mode === "json") {
		return (
			<div className="space-y-2">
				<div className="flex items-center justify-between gap-2">
					<div className="text-xs text-muted-foreground">
						<div>原始 JSON 编辑（不会自动切回可视化，需手动“应用并切换”）</div>
						{providerType === "anthropic" && (
							<div>Anthropic 需要配置 anthropic-version（字段名：version，例如 2023-06-01）</div>
						)}
						{rawParseError && <div className="text-destructive">{rawParseError}</div>}
					</div>
					<div className="flex items-center gap-2">
						<Button type="button" variant="secondary" size="sm" onClick={applyRawToVisual}>
							应用并切换
						</Button>
						<Button type="button" variant="outline" size="sm" onClick={() => setMode("visual")}>
							仅切换可视化
						</Button>
					</div>
				</div>
				<Textarea
					value={rawText}
					onChange={(e) => {
						const next = e.target.value;
						setRawText(next);
						setRawParseError(null);
						lastEmittedRef.current = next;
						onChange(next);
					}}
					className="resize-none whitespace-pre overflow-x-auto"
				/>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div className="text-xs text-muted-foreground">
					{error ? (
						<span className="text-destructive">{error}</span>
					) : (
						"填写完成后会自动序列化为 JSON 保存"
					)}
				</div>
				<div className="flex items-center gap-2">
					<Button type="button" variant="outline" size="sm" onClick={() => setMode("json")}>
						切换原始 JSON
					</Button>
					<Button type="button" variant="secondary" size="sm" onClick={addItem}>
						<Plus className="size-4" />
						添加字段
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground">
				<div className="col-span-4">键</div>
				<div className="col-span-3">类型</div>
				<div className="col-span-4">值</div>
				<div className="col-span-1 text-right">操作</div>
			</div>

			<div className="space-y-3">
				{items.map(item => (
					<div key={item.id} className="grid grid-cols-12 gap-2 items-end">
						<div className="col-span-4">
							<Input
								value={item.key}
								disabled={item.locked}
								onChange={(e) => updateItem(item.id, { key: e.target.value })}
								placeholder="例如: base_url"
								aria-label="键"
							/>
						</div>

						<div className="col-span-3">
							<Select
								value={item.type}
								onValueChange={(v) => updateItem(item.id, { type: v as ConfigValueType })}
								disabled={item.locked}
							>
								<SelectTrigger>
									<SelectValue placeholder="选择类型" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="string">字符串</SelectItem>
									<SelectItem value="number">数字</SelectItem>
									<SelectItem value="boolean">布尔</SelectItem>
									<SelectItem value="json">JSON</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="col-span-4">
							{item.type === "boolean" ? (
								<div className="flex items-center gap-2 h-10">
									<Switch
										checked={item.value === "true"}
										onCheckedChange={(checked) => updateItem(item.id, { value: String(checked) })}
										aria-label="布尔值"
									/>
									<span className="text-xs text-muted-foreground">
										{item.value === "true" ? "true" : "false"}
									</span>
								</div>
							) : item.type === "json" ? (
								<Textarea
									value={item.value}
									onChange={(e) => updateItem(item.id, { value: e.target.value })}
									className="resize-none whitespace-pre overflow-x-auto min-h-24"
									placeholder='例如: {"foo":"bar"} 或 ["a","b"]'
									aria-label="JSON 值"
								/>
							) : (
								<Input
									type={item.type === "number" ? "number" : item.key === "api_key" ? "password" : "text"}
									value={item.value}
									onChange={(e) => updateItem(item.id, { value: e.target.value })}
									placeholder={
										item.key === "version"
											? "例如: 2023-06-01（对应 anthropic-version）"
											: `请输入 ${item.key || "值"}`
									}
									aria-label="值"
								/>
							)}
						</div>

						<div className="col-span-1 flex justify-end">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={item.locked}
								onClick={() => removeItem(item.id)}
								title="删除字段"
							>
								<Trash2 className="size-4" />
							</Button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
